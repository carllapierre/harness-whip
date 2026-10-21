import test from "node:test";
import assert from "node:assert/strict";
import { showStatus } from "../src/presentation/cli/commands/show-status.ts";
import { SqliteRecoveryStore } from "../src/infrastructure/persistence/sqlite-recovery-store.ts";
import { fixture, THREAD } from "./fixtures/recovery-fixture.ts";

test("status reports inspection failures even when the recovery ledger is empty", (t) => {
    const store = new SqliteRecoveryStore(":memory:");
    t.after(() => store.close());
    store.setIssue({ key: THREAD, reason: "Approval is pending", observedAt: 1000 });
    let output = "";
    const write = t.mock.method(process.stdout, "write", (data: string | Uint8Array) => {
        output += data.toString();
        return true;
    });
    showStatus(store, "/state", true);
    write.mock.restore();
    const status = JSON.parse(output) as {
        recoveries: unknown[];
        needsAttention: number;
        inspectionIssues: { key: string }[];
    };
    assert.equal(status.recoveries.length, 0);
    assert.equal(status.needsAttention, 1);
    assert.equal(status.inspectionIssues[0]?.key, THREAD);
});

test("pending recovery inspection failures appear before unrelated unloaded chats", async (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.codex.quotaState.allowed = false;
    await f.watcher.tick();
    for (let index = 0; index < 6; index++) {
        f.store.setIssue({
            key: `000-${index}`,
            reason: "Unloaded conversation",
            observedAt: 1000,
        });
    }
    f.store.setIssue({
        key: THREAD,
        reason: "Desktop frame size exceeds the supported range",
        observedAt: 1000,
    });
    let output = "";
    const write = t.mock.method(process.stdout, "write", (data: string | Uint8Array) => {
        output += data.toString();
        return true;
    });
    showStatus(f.store, "/state", false);
    write.mock.restore();
    assert.match(output, /Desktop frame size exceeds the supported range/);
    assert.ok(output.indexOf(THREAD) < output.indexOf("000-0"));
});
