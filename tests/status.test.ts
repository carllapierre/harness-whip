import test from "node:test";
import assert from "node:assert/strict";
import { showStatus } from "../src/presentation/cli/commands/show-status.ts";
import { SqliteRecoveryStore } from "../src/infrastructure/persistence/sqlite-recovery-store.ts";
import { THREAD } from "./fixtures/recovery-fixture.ts";

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
