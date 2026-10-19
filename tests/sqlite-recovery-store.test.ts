import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRecoveryStore } from "../src/infrastructure/persistence/sqlite-recovery-store.ts";
import type { Recovery } from "../src/domain/recovery/recovery-model.ts";
import { THREAD, TURN } from "./fixtures/recovery-fixture.ts";

const recovery = (): Recovery => ({
    id: `${THREAD}:${TURN}`,
    threadId: THREAD,
    failedTurnId: TURN,
    project: "/example",
    title: "Example",
    fingerprint: "stable",
    status: "waiting",
    dueAt: 2000,
    createdAt: 1000,
    updatedAt: 1000,
    reason: "Quota failure",
    confirmation: null,
});

test("pending state, deduplication and dispatch intent survive reopening the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-whip-test-"));
    const path = join(directory, "state.sqlite");
    try {
        const first = new SqliteRecoveryStore(path);
        assert.equal(first.add(recovery()), true);
        first.markSeen(THREAD, TURN);
        first.pause(true);
        first.close();
        const second = new SqliteRecoveryStore(path);
        assert.equal(second.recoveries()[0]?.dueAt, 2000);
        assert.equal(second.add(recovery()), false);
        assert.equal(second.seen(THREAD), TURN);
        assert.equal(second.claim(recovery().id, 3000), false);
        second.pause(false);
        assert.equal(second.claim(recovery().id, 3000), true);
        second.close();
        const third = new SqliteRecoveryStore(path);
        assert.equal(third.claim(recovery().id, 4000), false);
        assert.equal(third.recoveries()[0]?.status, "dispatching");
        third.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("two store connections cannot both claim the same recovery or watcher lease", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-whip-test-"));
    const path = join(directory, "state.sqlite");
    const first = new SqliteRecoveryStore(path);
    const second = new SqliteRecoveryStore(path);
    try {
        first.add(recovery());
        assert.equal(first.claim(recovery().id, 1000), true);
        assert.equal(second.claim(recovery().id, 1000), false);
        assert.equal(first.acquireLease("one", 1000), true);
        assert.equal(second.acquireLease("two", 1000), false);
        assert.equal(first.acquireLease("one", 15_000), true);
        assert.equal(second.acquireLease("two", 130_000), false);
        assert.equal(second.acquireLease("two", 140_000), true);
        first.releaseLease("one");
        assert.equal(first.acquireLease("one", 140_001), false);
    } finally {
        first.close();
        second.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("a watcher with an expired or replaced lease cannot claim a dispatch", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-whip-test-"));
    const path = join(directory, "state.sqlite");
    const store = new SqliteRecoveryStore(path);
    const rival = new SqliteRecoveryStore(path);
    try {
        store.add(recovery());
        store.acquireLease("old-owner", 1000);
        assert.equal(store.claim(recovery().id, 121_001), false);
        rival.acquireLease("new-owner", 121_001);
        assert.equal(store.acquireLease("old-owner", 121_002), false);
        assert.equal(store.claim(recovery().id, 121_003), false);
    } finally {
        store.close();
        rival.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
