import test from "node:test";
import assert from "node:assert/strict";
import { fixture, THREAD, TURN } from "./fixtures/recovery-fixture.ts";

test("explicit failed conversation is continued exactly once and counted after confirmation", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    await f.watcher.tick();
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 1);
    assert.equal(f.codex.sends[0]?.id, THREAD);
    assert.match(f.codex.sends[0]!.message, /Preserve the original task scope/);
    assert.ok(f.codex.sends[0]!.message.includes(`[codex-whip:${THREAD}:${TURN}]`));
    assert.equal(f.store.recoveries()[0]?.status, "confirmed");
    assert.equal(f.events.filter((event) => event.kind === "whip").length, 1);
});

test("broad scopes baseline historical failures across repeated checks", async (t) => {
    const f = fixture({ scope: { all: true, projects: [], threads: [], excludedThreads: [] } });
    t.after(() => f.store.close());
    await f.watcher.tick();
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 0);
    assert.equal(f.store.recoveries().length, 0);
});

test("a newly started turn can hit quota before its first broad-scope observation", async (t) => {
    const f = fixture({ scope: { all: true, projects: [], threads: [], excludedThreads: [] } });
    t.after(() => f.store.close());
    f.codex.state.turnStartedAt = f.clock.value + 1;
    f.clock.value += 100;
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 1);
});

test("a running turn observed by a broad scope may later fail with the same turn ID", async (t) => {
    const f = fixture({ scope: { all: true, projects: [], threads: [], excludedThreads: [] } });
    t.after(() => f.store.close());
    f.codex.state.turnStatus = "inProgress";
    f.codex.state.runtime = "active";
    await f.watcher.tick();
    f.codex.state.turnStatus = "failed";
    f.codex.state.runtime = "systemError";
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 1);
});

test("capacity is reread after reset and a moved reset is persisted", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.quotaState.windows[0]!.usedPercent = 100;
    f.codex.quotaState.windows[0]!.resetsAt = f.clock.value + 100_000;
    await f.watcher.tick();
    assert.equal(f.store.recoveries()[0]?.dueAt, f.clock.value + 30_000);
    f.clock.value += 115_000;
    f.codex.quotaState.observedAt = f.clock.value;
    f.codex.quotaState.windows[0]!.resetsAt = f.clock.value + 200_000;
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 0);
    assert.equal(f.store.recoveries()[0]?.dueAt, f.clock.value + 30_000);
    f.clock.value += 215_000;
    f.codex.quotaState.observedAt = f.clock.value;
    f.codex.quotaState.windows[0]!.usedPercent = 30;
    f.codex.quotaState.windows[0]!.resetsAt = f.clock.value + 1_000_000;
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 1);
});

test("manual continuation or settings changes cancel pending recovery", async (t) => {
    for (const change of [
        { turnId: "new-user-turn" },
        { fingerprint: "changed-permissions" },
        { blocked: true },
        { turnStatus: "interrupted" as const },
    ]) {
        const f = fixture();
        t.after(() => f.store.close());
        f.codex.quotaState.allowed = false;
        await f.watcher.tick();
        Object.assign(f.codex.state, change);
        await f.watcher.tick();
        assert.equal(f.store.recoveries()[0]?.status, "canceled");
        assert.equal(f.codex.sends.length, 0);
    }
});

test("an early manual reset is detected before the original exhausted window resets", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.quotaState.windows[0]!.usedPercent = 100;
    f.codex.quotaState.windows[0]!.resetsAt = f.clock.value + 18_000_000;
    await f.watcher.tick();
    f.codex.quotaState.windows[0]!.usedPercent = 0;
    f.clock.value += 30_000;
    f.codex.quotaState.observedAt = f.clock.value;
    await f.watcher.tick();
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 1);
    assert.equal(f.store.recoveries()[0]?.status, "confirmed");
});

test("blocked quota failures are visible and inspection issues clear after recovery", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.state.blocked = true;
    f.codex.state.blockedReason = "Desktop approval is pending";
    await f.watcher.tick();
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 0);
    assert.equal(f.store.issues()[0]?.reason, "Desktop approval is pending");
    assert.equal(f.events.filter((event) => event.kind === "attention").length, 1);
    f.codex.state.blocked = false;
    f.codex.state.blockedReason = null;
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 1);
    assert.equal(f.store.issues().length, 0);
});

test("failed inspections persist as issues even when no recovery exists", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.onInspect = () => {
        throw new Error("Snapshot unavailable");
    };
    await f.watcher.tick();
    assert.equal(f.store.recoveries().length, 0);
    assert.equal(f.store.issues()[0]?.key, THREAD);
    f.codex.listed = false;
    await f.watcher.tick();
    assert.equal(f.store.issues().length, 0);
});

test("an unknown runtime cannot silently hide an observed quota failure", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.state.runtime = "unknown";
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 0);
    assert.match(f.store.issues()[0]!.reason, /runtime=unknown/);
});

test("uncertain delivery is recorded and never automatically retried", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.failDelivery = true;
    await f.watcher.tick();
    f.clock.value += 120_000;
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 1);
    assert.equal(f.store.recoveries()[0]?.status, "attention");
    assert.equal(
        f.events.some((event) => event.kind === "whip"),
        false,
    );
});

test("a conversation changed during the final check is not submitted", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.onInspect = () => {
        if (f.codex.inspectCount === 2) {
            f.codex.state.fingerprint = "changed";
        }
    };
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 0);
    assert.equal(f.store.recoveries()[0]?.status, "canceled");
});

test("pause or exclusion arriving during the final check blocks the atomic claim", async (t) => {
    for (const pause of [true, false]) {
        const f = fixture();
        t.after(() => f.store.close());
        f.codex.onInspect = () => {
            if (f.codex.inspectCount === 2) {
                if (pause) {
                    f.store.pause(true);
                } else {
                    f.store.exclude(THREAD, true);
                }
            }
        };
        await f.watcher.tick();
        assert.equal(f.codex.sends.length, 0);
    }
});

test("dry run records eligibility but submits and counts nothing", async (t) => {
    const f = fixture({ dryRun: true });
    t.after(() => f.store.close());
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 0);
    assert.equal(f.store.recoveries()[0]?.status, "waiting");
    assert.ok(f.events.some((event) => event.kind === "dry-run"));
});

test("archival or leaving the scope cancels pending work", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.quotaState.allowed = false;
    await f.watcher.tick();
    f.codex.listed = false;
    await f.watcher.tick();
    assert.equal(f.store.recoveries()[0]?.status, "canceled");
});

test("distinct quota failures continue without a per-conversation cap and never duplicate a send", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    for (let index = 0; index < 20; index++) {
        f.codex.state.turnId = `quota-failure-${index}`;
        f.codex.quotaState.observedAt = f.clock.value;
        await f.watcher.tick();
        await f.watcher.tick();
        assert.equal(f.codex.sends.length, index + 1);
        f.clock.value += 11_000;
    }
    assert.equal(f.store.recoveries().filter((entry) => entry.status === "confirmed").length, 20);
    assert.equal(f.store.recoveries().filter((entry) => entry.status === "attention").length, 0);
});

test("shutdown requested during a check prevents dispatch", async (t) => {
    let stopping = false;
    const f = fixture({ shouldStop: () => stopping });
    t.after(() => f.store.close());
    f.codex.onInspect = () => {
        if (f.codex.inspectCount === 2) {
            stopping = true;
        }
    };
    await f.watcher.tick();
    assert.equal(f.codex.sends.length, 0);
});

test("repeated connection errors are logged only when they change", () => {
    const f = fixture();
    try {
        f.watcher.reportConnectionError(new Error("offline"));
        f.watcher.reportConnectionError(new Error("offline"));
        f.watcher.reportConnectionError(new Error("logged out"));
        assert.equal(f.events.length, 2);
    } finally {
        f.store.close();
    }
});
