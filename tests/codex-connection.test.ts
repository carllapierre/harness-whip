import test from "node:test";
import assert from "node:assert/strict";
import {
    NativeCodexConnection,
    type ConnectionMode,
} from "../src/infrastructure/codex/codex-connection.ts";
import { THREAD, TURN } from "./fixtures/recovery-fixture.ts";
import { object } from "../src/infrastructure/codex/protocol-values.ts";

function adapterFixture(mode: ConnectionMode = "stdio") {
    let now = 1_000_000;
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
    const latest = { id: TURN, status: "failed", error: { codexErrorInfo: "usageLimitExceeded" } };
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
                    data: [{ ...latest }],
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
    const adapter = new NativeCodexConnection(
        "unused",
        "/example-codex-home",
        mode,
        undefined,
        () => now,
    );
    Object.assign(adapter, { rpc });
    return {
        adapter,
        calls,
        thread,
        latest,
        advanceTime: (milliseconds: number) => {
            now += milliseconds;
        },
        setQueued: () => {
            queued = true;
        },
        archive: () => {
            listed = false;
        },
    };
}

test("desktop monitoring uses cached summaries with an updatedAt check and a bounded refresh", async () => {
    const f = adapterFixture("desktop");
    Object.assign(f.adapter, {
        desktop: {
            read() {
                assert.fail("Monitoring must not request desktop history");
            },
        },
    });
    let [thread] = await f.adapter.listConversations();
    const observed = await f.adapter.observe(thread!);
    assert.equal(
        f.calls.find((call) => call.method === "thread/turns/list")?.params.itemsView,
        "notLoaded",
    );
    assert.equal(observed.quotaFailure, true);
    assert.equal("fingerprint" in observed, false);
    await f.adapter.observe(thread!);
    assert.equal(f.calls.filter((call) => call.method === "thread/turns/list").length, 1);
    f.thread.updatedAt++;
    f.latest.status = "inProgress";
    [thread] = await f.adapter.listConversations();
    assert.equal((await f.adapter.observe(thread!)).turnStatus, "inProgress");
    assert.equal(f.calls.filter((call) => call.method === "thread/turns/list").length, 2);
    f.advanceTime(30_000);
    f.latest.status = "failed";
    assert.equal((await f.adapter.observe(thread!)).turnStatus, "failed");
    assert.equal(f.calls.filter((call) => call.method === "thread/turns/list").length, 3);
    assert.equal(
        f.calls.some(
            (call) => call.method === "thread/read" || call.method === "thread/queue/list",
        ),
        false,
    );
});

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
