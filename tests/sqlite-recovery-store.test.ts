import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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

test("version-one databases upgrade without losing observed failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-whip-test-"));
    const path = join(directory, "state.sqlite");
    try {
        const legacy = new DatabaseSync(path);
        legacy.exec(
            readFileSync(new URL("../migrations/001-recovery.sql", import.meta.url), "utf8"),
        );
        legacy.prepare("INSERT INTO observed_threads VALUES (?,?)").run(THREAD, TURN);
        legacy.close();
        const upgraded = new SqliteRecoveryStore(path);
        try {
            assert.equal(upgraded.seen(THREAD), TURN);
            upgraded.setIssue({ key: THREAD, reason: "Blocked", observedAt: 1000 });
            assert.equal(upgraded.issues().length, 1);
        } finally {
            upgraded.close();
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("pending state, deduplication and dispatch intent survive reopening the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-whip-test-"));
    const path = join(directory, "state.sqlite");
    try {
        const first = new SqliteRecoveryStore(path);
        assert.equal(first.add(recovery()), true);
        first.markSeen(THREAD, TURN);
        first.setIssue({ key: THREAD, reason: "Snapshot unavailable", observedAt: 1000 });
        first.pause(true);
        first.close();
        const second = new SqliteRecoveryStore(path);
        assert.equal(second.recoveries()[0]?.dueAt, 2000);
        assert.equal(second.add(recovery()), false);
        assert.equal(second.seen(THREAD), TURN);
        assert.equal(second.issues()[0]?.reason, "Snapshot unavailable");
        second.clearIssue(THREAD);
        assert.equal(second.issues().length, 0);
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

test("upgrade releases unsent budget-blocked recoveries and preserves every delivery guard", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-whip-test-"));
    const path = join(directory, "state.sqlite");
    const budget = "Per-conversation whip budget reached";
    const entries: Recovery[] = [
        {
            ...recovery(),
            id: "unsent",
            failedTurnId: "unsent",
            status: "attention",
            reason: budget,
        },
        {
            ...recovery(),
            id: "uncertain",
            failedTurnId: "uncertain",
            status: "attention",
            reason: "Delivery uncertain; automatic retry disabled",
        },
        { ...recovery(), id: "sent", failedTurnId: "sent", status: "attention", reason: budget },
        {
            ...recovery(),
            id: "confirmed",
            failedTurnId: "confirmed",
            status: "confirmed",
            reason: budget,
            confirmation: "new-turn",
        },
        {
            ...recovery(),
            id: "canceled",
            failedTurnId: "canceled",
            status: "canceled",
            reason: budget,
        },
        {
            ...recovery(),
            id: "receipt",
            failedTurnId: "receipt",
            status: "attention",
            reason: budget,
            confirmation: "accepted-turn",
        },
        {
            ...recovery(),
            id: "dispatching",
            failedTurnId: "dispatching",
            status: "dispatching",
            reason: budget,
        },
    ];
    try {
        const legacy = new DatabaseSync(path);
        for (const migration of ["001-recovery.sql", "002-monitoring-issues.sql"]) {
            legacy.exec(
                readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"),
            );
        }
        for (const entry of entries) {
            legacy
                .prepare("INSERT INTO recoveries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
                .run(
                    entry.id,
                    entry.threadId,
                    entry.failedTurnId,
                    entry.project,
                    entry.title,
                    entry.fingerprint,
                    entry.status,
                    entry.dueAt,
                    entry.createdAt,
                    entry.updatedAt,
                    entry.reason,
                    entry.confirmation,
                );
        }
        legacy
            .prepare(
                "INSERT INTO activity(at,kind,message,recovery_id) VALUES (1000,'send','Dispatch intent saved','sent')",
            )
            .run();
        legacy.close();
        const upgraded = new SqliteRecoveryStore(path);
        try {
            const restored = upgraded.recoveries().find((entry) => entry.id === "unsent")!;
            assert.equal(restored.status, "waiting");
            assert.equal(restored.dueAt, 0);
            assert.equal(restored.fingerprint, recovery().fingerprint);
            for (const original of entries.filter((entry) => entry.id !== "unsent")) {
                assert.deepEqual(
                    { ...upgraded.recoveries().find((entry) => entry.id === original.id) },
                    original,
                );
            }
            assert.equal(upgraded.history(10)[0]?.kind, "send");
        } finally {
            upgraded.close();
        }
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
