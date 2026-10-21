import test from "node:test";
import assert from "node:assert/strict";
import {
    NativeCodexConnection,
    type ConnectionMode,
} from "../src/infrastructure/codex/codex-connection.ts";
import { THREAD, TURN } from "./fixtures/recovery-fixture.ts";
import { object } from "../src/infrastructure/codex/protocol-values.ts";
import { RpcError } from "../src/infrastructure/codex/app-server-rpc.ts";

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
    let listing: ((params: Record<string, unknown>) => unknown) | undefined;
    const latest = { id: TURN, status: "failed", error: { codexErrorInfo: "usageLimitExceeded" } };
    const rpc = {
        async call(method: string, parameters: unknown) {
            const params = object(parameters);
            calls.push({ method, params });
            if (method === "thread/list") {
                if (listing) {
                    return listing(params);
                }
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
        setListing: (value: (params: Record<string, unknown>) => unknown) => {
            listing = value;
        },
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

test("database polling retains rollout-only chats and reconciles their removal", async () => {
    const f = adapterFixture();
    const legacy = { ...f.thread, id: "019a0000-0000-7000-8000-000000000003" };
    let full = [f.thread, legacy];
    f.setListing((params) => ({
        data: params.useStateDbOnly ? [f.thread] : full,
        nextCursor: null,
    }));
    assert.equal((await f.adapter.listConversations()).length, 2);
    assert.deepEqual(
        f.calls
            .filter((call) => call.method === "thread/list")
            .map((call) => call.params.useStateDbOnly ?? false),
        [true, false],
    );
    full = [f.thread];
    f.advanceTime(30_000);
    assert.equal(
        (await f.adapter.listConversations()).some((thread) => thread.id === legacy.id),
        true,
    );
    assert.equal(
        f.calls.filter((call) => call.method === "thread/list" && !call.params.useStateDbOnly)
            .length,
        1,
    );
    f.advanceTime(270_000);
    assert.equal((await f.adapter.listConversations()).length, 1);
    assert.equal(
        f.calls.filter((call) => call.method === "thread/list" && !call.params.useStateDbOnly)
            .length,
        2,
    );
});

test("rollout-only chats that become indexed are deduplicated and obey database removal", async () => {
    const f = adapterFixture();
    const legacy = { ...f.thread, id: "019a0000-0000-7000-8000-000000000003" };
    let indexed = [f.thread];
    f.setListing((params) => ({
        data: params.useStateDbOnly ? indexed : [f.thread, legacy],
        nextCursor: null,
    }));
    await f.adapter.listConversations();
    indexed = [f.thread, legacy];
    assert.equal((await f.adapter.listConversations()).length, 2);
    indexed = [f.thread];
    assert.equal(
        (await f.adapter.listConversations()).some((thread) => thread.id === legacy.id),
        false,
    );
});

test("an archived rollout-only chat cannot dispatch from the discovery cache", async () => {
    const f = adapterFixture();
    let archived = false;
    f.setListing((params) => ({
        data: params.useStateDbOnly || archived ? [] : [f.thread],
        nextCursor: null,
    }));
    await f.adapter.listConversations();
    const expected = await f.adapter.inspect(THREAD);
    archived = true;
    assert.equal((await f.adapter.listConversations()).length, 1);
    await assert.rejects(f.adapter.continue(THREAD, "Continue", expected), /archived/);
    assert.equal(
        f.calls.some((call) => call.method === "turn/start"),
        false,
    );
});

test("unsupported database-only options fall back to full discovery", async () => {
    const f = adapterFixture();
    f.setListing((params) => {
        if (params.useStateDbOnly) {
            throw new RpcError("Unsupported parameter", -32602);
        }
        return { data: [f.thread], nextCursor: null };
    });
    assert.equal((await f.adapter.listConversations()).length, 1);
    assert.equal((await f.adapter.listConversations()).length, 1);
    assert.equal(f.calls.filter((call) => call.params.useStateDbOnly).length, 1);
});

test("failed reconciliation is retried without publishing a partial listing", async () => {
    const f = adapterFixture();
    let failing = true;
    f.setListing((params) => {
        if (!params.useStateDbOnly && failing) {
            throw new Error("Reconciliation failed");
        }
        return { data: [f.thread], nextCursor: null };
    });
    await assert.rejects(f.adapter.listConversations(), /Reconciliation failed/);
    failing = false;
    assert.equal((await f.adapter.listConversations()).length, 1);
    assert.equal(
        f.calls.filter((call) => call.method === "thread/list" && !call.params.useStateDbOnly)
            .length,
        2,
    );
});

test("both discovery paths page completely and retain the database flag on every page", async () => {
    const f = adapterFixture();
    const other = { ...f.thread, id: "019a0000-0000-7000-8000-000000000003" };
    f.setListing((params) => ({
        data: params.cursor ? [other] : [f.thread],
        nextCursor: params.cursor ? null : "next-page",
    }));
    assert.equal((await f.adapter.listConversations()).length, 2);
    const first = f.calls.filter((call) => call.method === "thread/list");
    assert.deepEqual(
        first.map((call) => call.params.useStateDbOnly ?? false),
        [true, true, false, false],
    );
    assert.deepEqual(
        first.map((call) => call.params.cursor),
        [undefined, "next-page", undefined, "next-page"],
    );
    await f.adapter.listConversations();
    const last = f.calls.filter((call) => call.method === "thread/list").slice(-2);
    assert.ok(last.every((call) => call.params.useStateDbOnly === true));
});

test("cold turn metadata is reused until changed or periodic refresh is due", async () => {
    const f = adapterFixture();
    f.latest.status = "completed";
    let [thread] = await f.adapter.listConversations();
    await f.adapter.observe(thread!);
    f.advanceTime(30_000);
    await f.adapter.observe(thread!);
    assert.equal(f.calls.filter((call) => call.method === "thread/turns/list").length, 1);
    f.thread.updatedAt++;
    f.latest.status = "interrupted";
    [thread] = await f.adapter.listConversations();
    assert.equal((await f.adapter.observe(thread!)).turnStatus, "interrupted");
    f.advanceTime(300_000);
    f.latest.status = "failed";
    assert.equal((await f.adapter.observe(thread!)).turnStatus, "failed");
    assert.equal(f.calls.filter((call) => call.method === "thread/turns/list").length, 3);
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
