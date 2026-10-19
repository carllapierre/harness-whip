import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { AppServerRpc } from "../src/infrastructure/codex/app-server-rpc.ts";

function connection(timeout = 1000) {
    // The fixture is source JavaScript, so find it relative to the repository root.
    const fixture = fileURLToPath(
        new URL("../../../tests/fixtures/fake-codex.mjs", import.meta.url),
    );
    return new AppServerRpc(process.execPath, "/unused", "stdio", undefined, timeout, [fixture]);
}

test("RPC correlates concurrent requests and excludes private remote error text", async () => {
    const rpc = connection();
    try {
        assert.deepEqual(
            await Promise.all([
                rpc.call("test/echo", { value: 1 }),
                rpc.call("test/echo", { value: 2 }),
            ]),
            [{ value: 1 }, { value: 2 }],
        );
        await assert.rejects(
            rpc.call("test/error"),
            (error: unknown) =>
                error instanceof Error && !error.message.includes("private remote details"),
        );
        await rpc.call("test/approval");
        assert.equal(rpc.blocked("example"), true);
    } finally {
        await rpc.close();
    }
});

test("RPC timeout or process exit rejects the outstanding request", async () => {
    const rpc = connection(500);
    try {
        await assert.rejects(rpc.call("test/hang"), /timed out/);
        await assert.rejects(rpc.call("test/disconnect"), /disconnected/);
    } finally {
        await rpc.close();
    }
});
