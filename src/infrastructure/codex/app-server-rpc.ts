import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { object, text } from "./protocol-values.ts";

export class RpcError extends Error {
    constructor(
        message: string,
        readonly code?: number,
    ) {
        super(message);
    }
}

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export class AppServerRpc {
    private child?: ChildProcessWithoutNullStreams;
    private pending = new Map<number, Pending>();
    private sequence = 0;
    private buffer = "";
    private opening?: Promise<void>;
    private blockedThreads = new Set<string>();

    constructor(
        private binary: string,
        private home: string,
        private mode: "stdio" | "proxy" = "stdio",
        private socket?: string,
        private timeoutMs = 25_000,
        private launcherArgs: string[] = [],
    ) {}

    async open(): Promise<void> {
        if (!this.opening) {
            this.opening = this.start().catch((error: unknown) => {
                this.opening = undefined;
                throw error;
            });
        }
        return this.opening;
    }

    private async start(): Promise<void> {
        const args =
            this.mode === "proxy"
                ? ["app-server", "proxy", ...(this.socket ? ["--sock", this.socket] : [])]
                : ["app-server", "--stdio"];
        const child = spawn(this.binary, [...this.launcherArgs, ...args], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: { ...process.env, CODEX_HOME: this.home },
        });
        this.child = child;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => this.receive(chunk));
        child.stderr.resume();
        child.stdin.on("error", () => this.fail(new Error("Codex connection closed")));
        child.on("error", () => this.fail(new Error("Unable to launch Codex app-server")));
        child.on("exit", () => {
            if (this.child === child) {
                this.child = undefined;
                this.opening = undefined;
                this.fail(new Error("Codex app-server disconnected; check the connection mode"));
            }
        });
        const initialized = object(
            await this.request("initialize", {
                clientInfo: { name: "harness_whip", title: "Harness Whip", version: "0.1.0" },
                capabilities: { experimentalApi: true },
            }),
        );
        if (
            initialized.codexHome &&
            text(initialized.codexHome).replaceAll("\\", "/").toLowerCase() !==
                this.home.replaceAll("\\", "/").toLowerCase()
        ) {
            await this.close();
            throw new Error("Codex returned a different home directory");
        }
        this.write({ method: "initialized" });
    }

    private write(message: unknown): void {
        if (!this.child || this.child.stdin.destroyed) {
            throw new Error("Codex connection is unavailable");
        }
        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    private receive(chunk: string): void {
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer) > 32 * 1024 * 1024) {
            this.fail(new Error("Codex response exceeds the size limit"));
            void this.close();
            return;
        }
        let newline: number;
        while ((newline = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            if (!line.trim()) {
                continue;
            }
            try {
                const message = object(JSON.parse(line));
                if (message.method) {
                    if (message.id !== undefined) {
                        const params = object(message.params);
                        if (typeof params.threadId === "string") {
                            this.blockedThreads.add(params.threadId);
                        }
                        // Never accept approvals or invent user answers.
                        this.write({
                            id: message.id,
                            error: {
                                code: -32601,
                                message:
                                    "Harness Whip cannot answer approval, input, or tool requests",
                            },
                        });
                    }
                    continue;
                }
                const pending =
                    typeof message.id === "number" ? this.pending.get(message.id) : undefined;
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(message.id as number);
                    if (message.error) {
                        const error = object(message.error);
                        pending.reject(
                            new RpcError(
                                `Codex rejected request (${String(error.code ?? "unknown")}); check compatibility and authentication`,
                                typeof error.code === "number" ? error.code : undefined,
                            ),
                        );
                    } else {
                        pending.resolve(message.result);
                    }
                }
            } catch {
                this.fail(new Error("Codex sent an invalid protocol message"));
            }
        }
    }

    private fail(error: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }

    async call(method: string, params?: unknown): Promise<unknown> {
        await this.open();
        return this.request(method, params);
    }

    private request(method: string, params?: unknown): Promise<unknown> {
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Codex ${method} timed out`));
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.write({ id, method, ...(params === undefined ? {} : { params }) });
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    blocked(threadId: string): boolean {
        return this.blockedThreads.has(threadId);
    }

    async close(): Promise<void> {
        const child = this.child;
        this.child = undefined;
        this.opening = undefined;
        this.buffer = "";
        this.fail(new Error("Codex connection closed"));
        if (child) {
            child.stdin.end();
            child.kill();
            await new Promise<void>((resolve) => {
                if (child.exitCode !== null || child.signalCode !== null) {
                    resolve();
                    return;
                }
                const timer = setTimeout(() => {
                    child.kill("SIGKILL");
                    resolve();
                }, 2_000);
                child.once("exit", () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
    }
}
