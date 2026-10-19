import type { CodexConnection } from "../ports/codex-connection.ts";
import type { RecoveryStore } from "../ports/recovery-store.ts";
import type { Clock, EventSink } from "../ports/runtime.ts";
import type { Conversation, Recovery, WatchScope } from "../../domain/recovery/recovery-model.ts";
import { CONTINUATION } from "../../domain/recovery/recovery-model.ts";
import { eligible, quotaDecision, unchanged } from "../../domain/recovery/recovery-policy.ts";

export interface WatchOptions {
    scope: WatchScope;
    bucket?: string;
    dryRun: boolean;
    maxWhips: number;
    staggerMs: number;
    matchesProject: (project: string, selected: string) => boolean;
    shouldStop?: () => boolean;
}

export class WatchConversations {
    private nextDispatch = 0;
    private errors = new Map<string, string>();

    constructor(
        private codex: CodexConnection,
        private store: RecoveryStore,
        private clock: Clock,
        private events: EventSink,
        private options: WatchOptions,
    ) {}

    private emit(kind: string, message: string, threadId?: string, recoveryId?: string): void {
        const event = { at: this.clock.now(), kind, message, threadId, recoveryId };
        this.store.record(event);
        this.events.write(event);
    }

    private selected(thread: Conversation): boolean {
        const scope = this.options.scope;
        return (
            !thread.ephemeral &&
            !thread.parentId &&
            !scope.excludedThreads.includes(thread.id) &&
            !this.store.excluded(thread.id) &&
            (scope.all ||
                scope.threads.includes(thread.id) ||
                scope.projects.some((project) =>
                    this.options.matchesProject(thread.project, project),
                ))
        );
    }

    private reportError(key: string, error: unknown): void {
        const message = error instanceof Error ? error.message : "Unknown connection error";
        if (this.errors.get(key) !== message) {
            this.errors.set(key, message);
            this.emit("attention", message, key === "connection" ? undefined : key);
        }
    }

    async tick(): Promise<void> {
        if (this.store.paused() || this.options.shouldStop?.()) {
            return;
        }
        const threads = await this.codex.listConversations();
        this.errors.delete("connection");
        const selected = threads.filter((thread) => this.selected(thread));
        const current = new Set(selected.map((thread) => thread.id));
        for (const recovery of this.store
            .recoveries()
            .filter((entry) => entry.status === "waiting")) {
            if (!current.has(recovery.threadId)) {
                this.store.update(
                    recovery.id,
                    "canceled",
                    "Conversation archived, excluded, or outside the current scope",
                    this.clock.now(),
                );
                this.emit(
                    "cancel",
                    "Pending recovery left the watch scope",
                    recovery.threadId,
                    recovery.id,
                );
            }
        }
        for (const thread of selected) {
            if (this.store.paused() || this.options.shouldStop?.()) {
                break;
            }
            try {
                await this.observe(thread);
                this.errors.delete(thread.id);
            } catch (error) {
                this.reportError(thread.id, error);
            }
        }
    }

    reportConnectionError(error: unknown): void {
        this.reportError("connection", error);
    }

    private async observe(thread: Conversation): Promise<void> {
        const snapshot = await this.codex.inspect(thread.id);
        const now = this.clock.now();
        const seen = this.store.seen(thread.id);
        const existing = this.store
            .recoveries()
            .find(
                (entry) => entry.threadId === thread.id && entry.failedTurnId === snapshot.turnId,
            );
        if (seen === null) {
            this.store.markSeen(
                thread.id,
                snapshot.turnStatus === "failed" ? `baseline:${snapshot.turnId}` : snapshot.turnId,
            );
            // Explicit UUID selection may enroll an already failed conversation.
            // Broad scopes establish a baseline instead of resurrecting old failures.
            if (!this.options.scope.threads.includes(thread.id)) {
                return;
            }
        }
        if (snapshot.turnId && seen !== `baseline:${snapshot.turnId}`) {
            this.store.markSeen(thread.id, snapshot.turnId);
        }
        for (const entry of this.store
            .recoveries()
            .filter((item) => item.threadId === thread.id && item.status === "waiting")) {
            if (!unchanged(snapshot, entry.failedTurnId, entry.fingerprint)) {
                this.store.update(
                    entry.id,
                    "canceled",
                    "Conversation or execution settings changed",
                    now,
                );
                this.emit(
                    "cancel",
                    "Conversation changed; automatic continuation canceled",
                    thread.id,
                    entry.id,
                );
            }
        }
        if (!eligible(snapshot)) {
            return;
        }
        if (existing && existing.status !== "waiting") {
            return;
        }
        if (
            !existing &&
            seen === `baseline:${snapshot.turnId}` &&
            !this.options.scope.threads.includes(thread.id)
        ) {
            return;
        }
        const recovery: Recovery = existing ?? {
            id: `${thread.id}:${snapshot.turnId}`,
            threadId: thread.id,
            failedTurnId: snapshot.turnId,
            project: thread.project,
            title: thread.title,
            fingerprint: snapshot.fingerprint,
            status: "waiting",
            dueAt: now,
            createdAt: now,
            updatedAt: now,
            reason: "Confirmed usage-limit failure",
            confirmation: null,
        };
        if (!existing) {
            if (!this.store.add(recovery)) {
                return;
            }
            this.emit("wait", "Usage limit reached; recovery recorded", thread.id, recovery.id);
        }
        if (recovery.dueAt > now || now < this.nextDispatch) {
            return;
        }
        const decision = quotaDecision(
            await this.codex.quota(this.options.bucket),
            this.clock.now(),
        );
        if (!decision.ready) {
            this.store.update(recovery.id, "waiting", decision.reason, now, decision.nextCheck);
            this.emit(
                "wait",
                `${decision.reason}; check ${new Date(decision.nextCheck).toISOString()}`,
                thread.id,
                recovery.id,
            );
            return;
        }
        const count = this.store
            .recoveries()
            .filter(
                (entry) =>
                    entry.threadId === thread.id &&
                    (entry.status === "confirmed" ||
                        entry.status === "dispatching" ||
                        entry.status === "attention"),
            ).length;
        if (count >= this.options.maxWhips) {
            this.store.update(
                recovery.id,
                "attention",
                "Per-conversation whip budget reached",
                now,
            );
            this.emit("attention", "Per-conversation whip budget reached", thread.id, recovery.id);
            return;
        }
        const fresh = await this.codex.inspect(thread.id);
        if (!unchanged(fresh, recovery.failedTurnId, recovery.fingerprint)) {
            this.store.update(recovery.id, "canceled", "Conversation changed during recheck", now);
            return;
        }
        if (this.options.dryRun) {
            this.store.update(
                recovery.id,
                "waiting",
                "Dry run: continuation would be sent",
                now,
                now + 60_000,
            );
            this.emit("dry-run", "Would continue this exact conversation", thread.id, recovery.id);
            return;
        }
        // The persistent claim checks pause/exclusion atomically with the intent.
        if (this.options.shouldStop?.() || !this.store.claim(recovery.id, this.clock.now())) {
            return;
        }
        this.emit(
            "send",
            "Dispatch intent saved; submitting one continuation",
            thread.id,
            recovery.id,
        );
        this.nextDispatch = this.clock.now() + this.options.staggerMs;
        try {
            const confirmation = await this.codex.continue(
                thread.id,
                `${CONTINUATION}\n\n[codex-whip:${recovery.id}]`,
                fresh,
            );
            this.store.update(
                recovery.id,
                "confirmed",
                "Continuation turn confirmed",
                this.clock.now(),
                undefined,
                confirmation,
            );
            this.emit("whip", "Continuation confirmed", thread.id, recovery.id);
        } catch {
            this.store.update(
                recovery.id,
                "attention",
                "Delivery uncertain; automatic retry disabled",
                this.clock.now(),
            );
            this.emit(
                "attention",
                "Delivery uncertain; inspect the conversation before taking further action",
                thread.id,
                recovery.id,
            );
        }
    }
}
