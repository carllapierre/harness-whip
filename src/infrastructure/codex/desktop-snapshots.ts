import { connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { object, text, type ObjectValue } from "./protocol-values.ts";
import { DesktopFrameDecoder } from "./desktop-frame-decoder.ts";

// Experimental desktop IPC: read-only snapshots. Sending uses the official queue CLI.
export class DesktopSnapshots {
    constructor(
        private home: string,
        private endpoint?: string,
        private timeoutMs = 30_000,
    ) {}

    async read(threadId: string): Promise<ObjectValue> {
        const socket = connect(
            this.endpoint ??
                (process.platform === "win32"
                    ? "\\\\.\\pipe\\codex-ipc"
                    : join(this.home, "ipc", "ipc.sock")),
        );
        const session = new SnapshotSession(socket, this.timeoutMs);
        try {
            await session.connected();
            const initialized = await session.request(
                "initialize",
                { clientType: "harness-whip" },
                0,
            );
            session.clientId = text(object(initialized.result).clientId);
            if (!session.clientId) {
                throw new Error("Desktop initialization format is unsupported");
            }
            const owner = await session.request(
                "thread-owner-discovery",
                { hostId: "local", conversationId: threadId },
                1,
            );
            const ownerId = text(owner.handledByClientId);
            if (!ownerId) {
                throw new Error("Conversation is not loaded in the desktop app");
            }
            const snapshot = session.snapshot(threadId, ownerId);
            session.send({
                type: "broadcast",
                method: "thread-stream-following-changed",
                sourceClientId: session.clientId,
                targetClientIds: [ownerId],
                version: 1,
                params: { hostId: "local", conversationId: threadId, following: true },
            });
            return await snapshot;
        } finally {
            session.close();
        }
    }
}

class SnapshotSession {
    clientId = "initializing-client";
    private frames = new DesktopFrameDecoder();
    private listeners = new Set<(message: ObjectValue) => void>();
    private rejects = new Set<(error: Error) => void>();
    private connection: Promise<void>;

    constructor(
        private socket: Socket,
        private timeoutMs: number,
    ) {
        this.connection = new Promise((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("error", () =>
                reject(
                    new Error(
                        "Desktop IPC is unavailable; keep Codex open or use --connection proxy/stdio",
                    ),
                ),
            );
        });
        socket.on("data", (chunk: Buffer) => this.receive(chunk));
        socket.on("error", () => this.fail(new Error("Desktop IPC disconnected")));
        socket.on("close", () => this.fail(new Error("Desktop IPC closed")));
    }

    connected(): Promise<void> {
        return this.connection;
    }

    send(message: unknown): void {
        const data = Buffer.from(JSON.stringify(message));
        const prefix = Buffer.alloc(4);
        prefix.writeUInt32LE(data.length);
        this.socket.write(Buffer.concat([prefix, data]));
    }

    private receive(chunk: Buffer): void {
        try {
            this.frames.receive(chunk, (data) => {
                let decoded: unknown;
                try {
                    decoded = JSON.parse(data);
                } catch {
                    throw new Error("Desktop sent invalid JSON");
                }
                const message = object(decoded);
                if (message.type === "client-discovery-request") {
                    this.send({
                        type: "client-discovery-response",
                        requestId: message.requestId,
                        response: { canHandle: false },
                    });
                } else if (message.type === "request") {
                    this.send({
                        type: "response",
                        requestId: message.requestId,
                        resultType: "error",
                        error: "unsupported-by-harness-whip",
                    });
                }
                for (const listener of this.listeners) {
                    listener(message);
                }
            });
        } catch (error) {
            this.fail(error instanceof Error ? error : new Error("Unsupported desktop frame"));
            this.socket.destroy();
        }
    }

    private wait(match: (message: ObjectValue) => ObjectValue | undefined): Promise<ObjectValue> {
        return new Promise((resolve, reject) => {
            const finish = (error?: Error, result?: ObjectValue): void => {
                clearTimeout(timer);
                this.listeners.delete(listener);
                this.rejects.delete(onError);
                if (error) {
                    reject(error);
                } else {
                    resolve(result!);
                }
            };
            const onError = (error: Error): void => finish(error);
            const listener = (message: ObjectValue): void => {
                try {
                    const result = match(message);
                    if (result) {
                        finish(undefined, result);
                    }
                } catch (error) {
                    finish(error instanceof Error ? error : new Error("Unsupported desktop state"));
                }
            };
            const timer = setTimeout(
                () =>
                    finish(
                        new Error(
                            "Desktop query timed out; conversation may be unloaded or snapshot transfer too slow",
                        ),
                    ),
                this.timeoutMs,
            );
            this.listeners.add(listener);
            this.rejects.add(onError);
        });
    }

    async request(method: string, params: unknown, version: number): Promise<ObjectValue> {
        const requestId = randomUUID();
        const result = this.wait((message) => {
            if (message.type !== "response" || message.requestId !== requestId) {
                return;
            }
            if (message.resultType !== "success" || message.method !== method) {
                throw new Error(
                    "Desktop refused the query; conversation may not be loaded or protocol changed",
                );
            }
            return message;
        });
        this.send({
            type: "request",
            requestId,
            sourceClientId: this.clientId,
            method,
            params,
            version,
            timeoutMs: this.timeoutMs,
        });
        return result;
    }

    snapshot(threadId: string, owner: string): Promise<ObjectValue> {
        return this.wait((message) => {
            const params = object(message.params);
            if (
                message.type !== "broadcast" ||
                message.method !== "thread-stream-state-changed" ||
                message.sourceClientId !== owner ||
                params.conversationId !== threadId ||
                params.hostId !== "local"
            ) {
                return;
            }
            if (message.version !== 11) {
                throw new Error(
                    "Desktop snapshot protocol version changed; no continuation will be sent",
                );
            }
            const change = object(params.change);
            if (change.type !== "snapshot") {
                return;
            }
            const state = object(change.conversationState);
            if (state.id !== threadId) {
                throw new Error("Desktop returned a different conversation");
            }
            return state;
        });
    }

    private fail(error: Error): void {
        for (const reject of this.rejects) {
            reject(error);
        }
    }

    close(): void {
        this.socket.destroy();
    }
}
