import test from "node:test";
import assert from "node:assert/strict";
import { NativeCodexConnection } from "../src/infrastructure/codex/codex-connection.ts";
import { THREAD, TURN } from "./fixtures/recovery-fixture.ts";
import { object } from "../src/infrastructure/codex/protocol-values.ts";

function adapterFixture() {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const thread = {
        id: THREAD,
        name: "Synthetic",
        cwd: "/example",
        updatedAt: 100,
        ephemeral: false,
        parentThreadId: null,
        model: "inherited-model",
        reasoningEffort: "high",
        status: { type: "notLoaded" },
    };
    let queued = false;
    let listed = true;
    const rpc = {
        async call(method: string, parameters: unknown) {
            const params = object(parameters);
            calls.push({ method, params });
            if (method === "thread/list") {
                return { data: listed ? [thread] : [], nextCursor: null };
            }
            if (method === "thread/read") {
                return { thread: { ...thread } };
            }
            if (method === "thread/queue/list") {
                return { data: queued ? [{ id: "user-prompt" }] : [] };
            }
            if (method === "thread/goal/get") {
                return { goal: null };
            }
            if (method === "thread/turns/list") {
                return {
                    data: [
                        {
                            id: TURN,
                            status: "failed",
                            error: { codexErrorInfo: "usageLimitExceeded" },
                        },
                    ],
                };
            }
            if (method === "thread/resume") {
                thread.status = { type: "idle" };
                return { thread };
            }
            if (method === "turn/start") {
                return { turn: { id: "new-turn", status: "inProgress" } };
            }
            throw new Error(`Unexpected method ${method}`);
        },
        blocked() {
            return false;
        },
        async close() {},
    };
    const adapter = new NativeCodexConnection("unused", "/example-codex-home", "stdio");
    Object.assign(adapter, { rpc });
    return {
        adapter,
        calls,
        thread,
        setQueued: () => {
            queued = true;
        },
        archive: () => {
            listed = false;
        },
    };
}

test("headless continuation resumes the exact UUID and inherits execution settings", async () => {
    const f = adapterFixture();
    const expected = await f.adapter.inspect(THREAD);
    const result = await f.adapter.continue(THREAD, "Continue this work", expected);
    assert.equal(result, "new-turn");
    assert.deepEqual(f.calls.find((call) => call.method === "thread/resume")?.params, {
        threadId: THREAD,
        excludeTurns: true,
    });
    const start = f.calls.find((call) => call.method === "turn/start")!.params;
    assert.deepEqual(Object.keys(start).sort(), ["input", "threadId"]);
    assert.equal(start.threadId, THREAD);
});

test("a newly queued user message or changed model prevents headless dispatch", async () => {
    for (const mutation of ["queue", "model"]) {
        const f = adapterFixture();
        const expected = await f.adapter.inspect(THREAD);
        if (mutation === "queue") {
            f.setQueued();
        } else {
            f.thread.model = "changed-model";
        }
        await assert.rejects(f.adapter.continue(THREAD, "Continue", expected), /changed/);
        assert.equal(
            f.calls.some((call) => call.method === "turn/start"),
            false,
        );
    }
});

test("an archive between inspection and dispatch prevents headless submission", async () => {
    const f = adapterFixture();
    const expected = await f.adapter.inspect(THREAD);
    f.archive();
    await assert.rejects(f.adapter.continue(THREAD, "Continue", expected), /archived/);
    assert.equal(
        f.calls.some((call) => call.method === "turn/start"),
        false,
    );
});
