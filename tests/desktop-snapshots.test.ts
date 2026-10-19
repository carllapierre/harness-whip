import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopSnapshots } from "../src/infrastructure/codex/desktop-snapshots.ts";
import { object } from "../src/infrastructure/codex/protocol-values.ts";
import { THREAD } from "./fixtures/recovery-fixture.ts";

async function serverFixture(version: number) {
    const endpoint =
        process.platform === "win32"
            ? `\\\\.\\pipe\\codex-whip-test-${randomUUID()}`
            : join(tmpdir(), `whip-${randomUUID()}.sock`);
    const server = createServer((socket) => {
        let buffer = Buffer.alloc(0);
        const send = (message: unknown): void => {
            const body = Buffer.from(JSON.stringify(message));
            const prefix = Buffer.alloc(4);
            prefix.writeUInt32LE(body.length);
            const frame = Buffer.concat([prefix, body]);
            socket.write(frame.subarray(0, 3));
            socket.write(frame.subarray(3));
        };
        socket.on("data", (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
                const size = buffer.readUInt32LE(0);
                const message = object(JSON.parse(buffer.subarray(4, size + 4).toString("utf8")));
                buffer = buffer.subarray(size + 4);
                if (message.type === "request") {
                    send({
                        type: "response",
                        requestId: message.requestId,
                        method: message.method,
                        resultType: "success",
                        result: { clientId: "whip-client" },
                        handledByClientId: "desktop-owner",
                    });
                } else if (message.method === "thread-stream-following-changed") {
                    send({
                        type: "broadcast",
                        method: "thread-stream-state-changed",
                        sourceClientId: "desktop-owner",
                        version,
                        params: {
                            hostId: "local",
                            conversationId: THREAD,
                            change: {
                                type: "snapshot",
                                conversationState: { id: THREAD, title: "Équipement 🧰" },
                            },
                        },
                    });
                }
            }
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, resolve);
    });
    return {
        endpoint,
        async close() {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}

test("desktop snapshots handle fragmented frames and Unicode without owning the thread", async () => {
    const server = await serverFixture(11);
    try {
        const snapshot = await new DesktopSnapshots("/unused", server.endpoint, 1000).read(THREAD);
        assert.equal(snapshot.id, THREAD);
        assert.equal(snapshot.title, "Équipement 🧰");
    } finally {
        await server.close();
    }
});

test("an unrecognized desktop protocol version prevents inspection", async () => {
    const server = await serverFixture(12);
    try {
        await assert.rejects(
            new DesktopSnapshots("/unused", server.endpoint, 1000).read(THREAD),
            /version changed/,
        );
    } finally {
        await server.close();
    }
});
