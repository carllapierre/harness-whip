import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { RecoveryStore } from "../../application/ports/recovery-store.ts";
import type { Activity, MonitoringIssue, Recovery } from "../../domain/recovery/recovery-model.ts";

export class SqliteRecoveryStore implements RecoveryStore {
    private readonly db: DatabaseSync;
    private leaseOwner?: string;

    constructor(path: string) {
        if (path !== ":memory:") {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        }
        this.db = new DatabaseSync(path);
        this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
        const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
        if (typeof version === "number" && version > 3) {
            this.db.close();
            throw new Error("State was created by a newer Codex Whip; upgrade this installation");
        }
        for (const [index, migration] of [
            "001-recovery.sql",
            "002-monitoring-issues.sql",
            "003-remove-whip-budget.sql",
        ].entries()) {
            if (Number(version) <= index) {
                this.db.exec(
                    readFileSync(
                        new URL(`../../../migrations/${migration}`, import.meta.url),
                        "utf8",
                    ),
                );
            }
        }
        if (path !== ":memory:" && process.platform !== "win32") {
            chmodSync(path, 0o600);
        }
    }

    recoveries(): Recovery[] {
        return this.db
            .prepare(
                `SELECT id, thread_id AS threadId, failed_turn_id AS failedTurnId,
            project, title, fingerprint, status, due_at AS dueAt, created_at AS createdAt,
            updated_at AS updatedAt, reason, confirmation FROM recoveries ORDER BY created_at DESC`,
            )
            .all() as unknown as Recovery[];
    }

    add(entry: Recovery): boolean {
        return (
            this.db
                .prepare(`INSERT OR IGNORE INTO recoveries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
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
                ).changes === 1
        );
    }

    update(
        id: string,
        status: Recovery["status"],
        reason: string,
        at: number,
        dueAt?: number,
        confirmation?: string,
    ): void {
        this.db
            .prepare(
                `UPDATE recoveries SET status=?, reason=?, updated_at=?,
            due_at=COALESCE(?,due_at), confirmation=COALESCE(?,confirmation) WHERE id=?`,
            )
            .run(status, reason, at, dueAt ?? null, confirmation ?? null, id);
    }

    claim(id: string, at: number): boolean {
        return (
            this.db
                .prepare(
                    `UPDATE recoveries SET status='dispatching', updated_at=?, reason='Dispatch intent persisted'
            WHERE id=? AND status='waiting'
            AND NOT EXISTS (SELECT 1 FROM settings WHERE key='paused' AND value='true')
            AND NOT EXISTS (SELECT 1 FROM exclusions WHERE thread_id=recoveries.thread_id)
            AND (? IS NULL OR EXISTS (SELECT 1 FROM watcher_lease WHERE singleton=1 AND owner=? AND expires_at>?))`,
                )
                .run(at, id, this.leaseOwner ?? null, this.leaseOwner ?? null, at).changes === 1
        );
    }

    seen(threadId: string): string | null {
        return (
            (this.db.prepare("SELECT turn_id FROM observed_threads WHERE thread_id=?").get(threadId)
                ?.turn_id as string | undefined) ?? null
        );
    }

    markSeen(threadId: string, turnId: string): void {
        this.db
            .prepare(
                "INSERT INTO observed_threads VALUES (?,?) ON CONFLICT(thread_id) DO UPDATE SET turn_id=excluded.turn_id",
            )
            .run(threadId, turnId);
    }

    excluded(threadId: string): boolean {
        return !!this.db.prepare("SELECT 1 FROM exclusions WHERE thread_id=?").get(threadId);
    }

    issues(): MonitoringIssue[] {
        return this.db
            .prepare(
                "SELECT key, reason, observed_at AS observedAt FROM monitoring_issues ORDER BY key",
            )
            .all() as unknown as MonitoringIssue[];
    }

    setIssue(issue: MonitoringIssue): void {
        this.db
            .prepare(
                "INSERT INTO monitoring_issues VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET reason=excluded.reason, observed_at=excluded.observed_at",
            )
            .run(issue.key, issue.reason, issue.observedAt);
    }

    clearIssue(key: string): void {
        this.db.prepare("DELETE FROM monitoring_issues WHERE key=?").run(key);
    }

    exclude(threadId: string, value: boolean): void {
        if (value) {
            this.db.prepare("INSERT OR IGNORE INTO exclusions VALUES (?)").run(threadId);
            this.db
                .prepare(
                    "UPDATE recoveries SET status='canceled', reason='Canceled by user' WHERE thread_id=? AND status='waiting'",
                )
                .run(threadId);
        } else {
            this.db.prepare("DELETE FROM exclusions WHERE thread_id=?").run(threadId);
        }
    }

    paused(): boolean {
        return (
            this.db.prepare("SELECT value FROM settings WHERE key='paused'").get()?.value === "true"
        );
    }

    watcherRunning(now: number): boolean {
        const lease = this.db
            .prepare("SELECT expires_at FROM watcher_lease WHERE singleton=1")
            .get();
        return !!lease && Number(lease.expires_at) > now;
    }

    pause(value: boolean): void {
        this.db
            .prepare(
                "INSERT INTO settings VALUES ('paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(String(value));
    }

    record(event: Activity): void {
        this.db
            .prepare(
                "INSERT INTO activity(at,kind,message,thread_id,recovery_id) VALUES (?,?,?,?,?)",
            )
            .run(
                event.at,
                event.kind,
                event.message,
                event.threadId ?? null,
                event.recoveryId ?? null,
            );
    }

    history(limit: number): Activity[] {
        return this.db
            .prepare(
                "SELECT id, at, kind, message, thread_id AS threadId, recovery_id AS recoveryId FROM activity ORDER BY id DESC LIMIT ?",
            )
            .all(limit) as unknown as Activity[];
    }

    acquireLease(owner: string, now: number): boolean {
        const acquired =
            this.db
                .prepare(
                    `INSERT INTO watcher_lease VALUES (1,?,?)
            ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at
            WHERE watcher_lease.expires_at < ? OR watcher_lease.owner=?`,
                )
                .run(owner, now + 120_000, now, owner).changes === 1;
        if (acquired) {
            this.leaseOwner = owner;
        }
        return acquired;
    }

    releaseLease(owner: string): void {
        this.db.prepare("DELETE FROM watcher_lease WHERE singleton=1 AND owner=?").run(owner);
    }

    close(): void {
        this.db.close();
    }
}
