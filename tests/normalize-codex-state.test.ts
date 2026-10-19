import test from "node:test";
import assert from "node:assert/strict";
import {
    latestDesktopTurn,
    normalizeQuota,
    normalizeSnapshot,
} from "../src/infrastructure/codex/normalize-codex-state.ts";
import { snapshot, THREAD, TURN } from "./fixtures/recovery-fixture.ts";

test("quota errors require enum evidence, never matching error prose", () => {
    const meta = snapshot();
    const state = { status: { type: "systemError" }, model: "example" };
    assert.equal(
        normalizeSnapshot(
            meta,
            { id: TURN, status: "failed", error: { message: "usage limit exceeded" } },
            state,
            false,
        ).quotaFailure,
        false,
    );
    assert.equal(
        normalizeSnapshot(
            meta,
            { id: TURN, status: "failed", error: { codexErrorInfo: "usageLimitExceeded" } },
            state,
            false,
        ).quotaFailure,
        true,
    );
});

test("the canonical desktop history must include a verified newest boundary", () => {
    const history = {
        islands: [{ entries: [{ value: "turn-key" }], newerBoundary: { status: "exhausted" } }],
        entitiesByKey: { "turn-key": { turnId: TURN, status: "failed" } },
    };
    assert.equal(latestDesktopTurn({ turnHistory: { kind: "canonical", history } }).turnId, TURN);
    history.islands[0]!.newerBoundary.status = "unknown";
    assert.throws(
        () => latestDesktopTurn({ turnHistory: { kind: "canonical", history } }),
        /incomplete/,
    );
});

test("execution settings affect fingerprints, titles and token counters do not", () => {
    const turn = {
        turnId: TURN,
        status: "failed",
        error: { codexErrorInfo: "usageLimitExceeded" },
    };
    const state = {
        ephemeral: false,
        hostId: "local",
        resumeState: "resumed",
        requests: [],
        queuedFollowUps: [],
        cwd: "/example",
        latestModel: "model",
        currentPermissions: { sandbox: "workspace-write" },
        threadRuntimeStatus: { type: "systemError" },
    };
    const before = normalizeSnapshot(snapshot(), turn, state, true);
    const cosmetic = normalizeSnapshot(
        snapshot({ title: "Renamed" }),
        turn,
        { ...state, tokenCount: 100 },
        true,
    );
    assert.equal(before.fingerprint, cosmetic.fingerprint);
    assert.equal(before.blocked, false);
    assert.notEqual(
        before.fingerprint,
        normalizeSnapshot(snapshot(), turn, { ...state, latestModel: "other" }, true).fingerprint,
    );
    assert.equal(
        normalizeSnapshot(snapshot(), turn, { ...state, requests: [{ method: "approval" }] }, true)
            .blocked,
        true,
    );
});

test("continuation correlation is read only from actual user-message items", () => {
    const marker = `${THREAD}:${TURN}`;
    const turn = {
        id: "next-turn",
        status: "inProgress",
        items: [
            { type: "agentMessage", text: `[codex-whip:fake]` },
            {
                type: "userMessage",
                content: [{ type: "text", text: `Continue. [codex-whip:${marker}]` }],
            },
        ],
    };
    assert.equal(
        normalizeSnapshot(snapshot(), turn, { status: { type: "active" } }, false).continuationId,
        marker,
    );
});

test("quota bucket selection is explicit when several buckets exist", () => {
    const window = { usedPercent: 20, resetsAt: 10_000, windowDurationMins: 300 };
    const result = {
        rateLimitsByLimitId: {
            codex: { limitId: "codex", primary: window },
            other: { limitId: "other", primary: window },
        },
    };
    assert.throws(() => normalizeQuota(result, undefined, 1000), /Multiple/);
    assert.equal(normalizeQuota(result, "other", 1000).bucket, "other");
    assert.equal(normalizeQuota(result, "other", 1000).windows[0]?.resetsAt, 10_000_000);
});
