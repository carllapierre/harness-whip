import { SqliteRecoveryStore } from "../../src/infrastructure/persistence/sqlite-recovery-store.ts";
import {
    WatchConversations,
    type WatchOptions,
} from "../../src/application/recovery/watch-conversations.ts";
import type { CodexConnection } from "../../src/application/ports/codex-connection.ts";
import type {
    Activity,
    Conversation,
    QuotaSnapshot,
    ThreadSnapshot,
} from "../../src/domain/recovery/recovery-model.ts";

export const THREAD = "019a0000-0000-7000-8000-000000000001";
export const TURN = "019a0000-0000-7000-8000-000000000002";

export function snapshot(overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot {
    return {
        id: THREAD,
        title: "Synthetic migration",
        project: "/projects/example",
        updatedAt: 1_000_000,
        ephemeral: false,
        parentId: null,
        turnId: TURN,
        turnStatus: "failed",
        quotaFailure: true,
        runtime: "systemError",
        blocked: false,
        fingerprint: "stable-settings",
        continuationId: null,
        ...overrides,
    };
}

export class FakeCodex implements CodexConnection {
    state = snapshot();
    listed = true;
    sends: { id: string; message: string }[] = [];
    failDelivery = false;
    inspectCount = 0;
    onInspect?: () => void;
    quotaState: QuotaSnapshot = {
        bucket: "codex",
        allowed: true,
        observedAt: 1_000_000,
        windows: [{ usedPercent: 50, resetsAt: 10_000_000, durationMinutes: 300 }],
    };

    async listConversations(): Promise<Conversation[]> {
        return this.listed ? [this.state] : [];
    }
    async inspect(): Promise<ThreadSnapshot> {
        this.inspectCount++;
        this.onInspect?.();
        return { ...this.state };
    }
    async quota(): Promise<QuotaSnapshot> {
        return this.quotaState;
    }
    async continue(id: string, message: string): Promise<string> {
        this.sends.push({ id, message });
        if (this.failDelivery) {
            throw new Error("Connection dropped after send");
        }
        return "confirmed-new-turn";
    }
    async close(): Promise<void> {}
}

export function fixture(overrides: Partial<WatchOptions> = {}) {
    const codex = new FakeCodex();
    const store = new SqliteRecoveryStore(":memory:");
    const clock = {
        value: 1_000_000,
        now() {
            return this.value;
        },
    };
    const events: Activity[] = [];
    const options: WatchOptions = {
        scope: { all: false, projects: [], threads: [THREAD], excludedThreads: [] },
        dryRun: false,
        maxWhips: 3,
        staggerMs: 10_000,
        matchesProject: (project, selected) => project === selected,
        ...overrides,
    };
    const watcher = new WatchConversations(
        codex,
        store,
        clock,
        { write: (event) => events.push(event) },
        options,
    );
    return { codex, store, clock, events, options, watcher };
}
