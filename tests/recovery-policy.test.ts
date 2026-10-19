import test from "node:test";
import assert from "node:assert/strict";
import { eligible, quotaDecision } from "../src/domain/recovery/recovery-policy.ts";
import { snapshot } from "./fixtures/recovery-fixture.ts";
import type { QuotaSnapshot } from "../src/domain/recovery/recovery-model.ts";

const now = 1_000_000;
const quota = (overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot => ({
    bucket: "codex",
    allowed: true,
    observedAt: now,
    windows: [{ usedPercent: 90, resetsAt: now + 500_000, durationMinutes: 300 }],
    ...overrides,
});

test("only an unblocked structured quota failure qualifies", () => {
    assert.equal(eligible(snapshot()), true);
    for (const change of [
        { turnStatus: "completed" },
        { turnStatus: "interrupted" },
        { turnStatus: "inProgress" },
        { quotaFailure: false },
        { blocked: true },
        { ephemeral: true },
        { runtime: "notLoaded" },
        { parentId: "parent" },
        { turnId: "" },
    ] as const) {
        assert.equal(eligible(snapshot(change)), false, JSON.stringify(change));
    }
});

test("waits for the later of exhausted short and weekly windows", () => {
    const result = quotaDecision(
        quota({
            windows: [
                { usedPercent: 100, resetsAt: now + 100_000, durationMinutes: 300 },
                { usedPercent: 100, resetsAt: now + 900_000, durationMinutes: 10080 },
            ],
        }),
        now,
    );
    assert.equal(result.ready, false);
    assert.equal(result.nextCheck, now + 915_000);
});

test("missing, stale, malformed and denied quota never authorizes a send", () => {
    for (const state of [
        quota({ windows: [] }),
        quota({ observedAt: now - 61_000 }),
        quota({ allowed: false }),
        quota({ windows: [{ usedPercent: NaN, resetsAt: now + 100_000, durationMinutes: 300 }] }),
        quota({ windows: [{ usedPercent: 20, resetsAt: now - 1, durationMinutes: 300 }] }),
    ]) {
        assert.equal(quotaDecision(state, now).ready, false);
    }
    assert.equal(quotaDecision(quota(), now).ready, true);
});

test("an exhausted window with an old timestamp schedules another read, not an immediate send", () => {
    const result = quotaDecision(
        quota({ windows: [{ usedPercent: 100, resetsAt: now - 1, durationMinutes: 300 }] }),
        now,
    );
    assert.equal(result.ready, false);
    assert.equal(result.nextCheck, now + 60_000);
});
