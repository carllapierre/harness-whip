import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodexConnection } from "../../application/ports/codex-connection.ts";
import type {
    Conversation,
    QuotaSnapshot,
    ThreadSnapshot,
} from "../../domain/recovery/recovery-model.ts";
import { unchanged } from "../../domain/recovery/recovery-policy.ts";
import { AppServerRpc } from "./app-server-rpc.ts";
import { DesktopSnapshots } from "./desktop-snapshots.ts";
import {
    conversation,
    latestDesktopTurn,
    normalizeQuota,
    normalizeSnapshot,
} from "./normalize-codex-state.ts";
import { object, text, uuid } from "./protocol-values.ts";

const run = promisify(execFile);
export type ConnectionMode = "desktop" | "proxy" | "stdio";

export class NativeCodexConnection implements CodexConnection {
    private rpc: AppServerRpc;
    private desktop: DesktopSnapshots;
    private queueChecked = false;

    constructor(
        private binary: string,
        private home: string,
        private mode: ConnectionMode,
        socket?: string,
    ) {
        this.rpc = new AppServerRpc(
            binary,
            home,
            mode === "proxy" ? "proxy" : "stdio",
            mode === "proxy" ? socket : undefined,
        );
        this.desktop = new DesktopSnapshots(home, mode === "desktop" ? socket : undefined);
    }

    async listConversations(): Promise<Conversation[]> {
        const result: Conversation[] = [];
        let cursor: string | undefined;
        const visited = new Set<string>();
        do {
            const response = object(
                await this.rpc.call("thread/list", {
                    limit: 100,
                    cursor,
                    archived: false,
                    sourceKinds: ["cli", "vscode", "exec", "appServer"],
                    sortKey: "updated_at",
                    sortDirection: "desc",
                }),
            );
            if (!Array.isArray(response.data)) {
                throw new Error("Codex thread listing has an unsupported format");
            }
            for (const value of response.data) {
                const entry = conversation(value);
                if (!entry.ephemeral && !entry.parentId) {
                    result.push(entry);
                }
            }
            cursor = text(response.nextCursor) || undefined;
            if (cursor && visited.has(cursor)) {
                throw new Error("Codex returned a repeated pagination cursor");
            }
            if (cursor) {
                visited.add(cursor);
            }
        } while (cursor);
        return result;
    }

    async inspect(threadId: string): Promise<ThreadSnapshot> {
        uuid(threadId);
        const response = object(
            await this.rpc.call("thread/read", { threadId, includeTurns: false }),
        );
        const thread = object(response.thread);
        const meta = conversation(thread);
        const queue = object(await this.rpc.call("thread/queue/list", { threadId, limit: 1 }));
        if (!Array.isArray(queue.data)) {
            throw new Error("Cannot verify the conversation's queued messages");
        }
        if (this.mode === "desktop") {
            const state = await this.desktop.read(threadId);
            state.queuedFollowUps = queue.data;
            // Persisted API metadata supplies ephemeral/parent flags; IPC supplies live execution state.
            if (state.cwd !== meta.project) {
                throw new Error("Desktop project changed during inspection");
            }
            return normalizeSnapshot(meta, latestDesktopTurn(state), state, true);
        }
        const turns = object(
            await this.rpc.call("thread/turns/list", {
                threadId,
                limit: 1,
                sortDirection: "desc",
                itemsView: "summary",
            }),
        );
        if (!Array.isArray(turns.data)) {
            throw new Error("Codex turn history has an unsupported format");
        }
        const goal = object(await this.rpc.call("thread/goal/get", { threadId }));
        thread.threadGoal = goal.goal;
        thread.blocked =
            queue.data.length > 0 ||
            this.rpc.blocked(threadId) ||
            (goal.goal != null && object(goal.goal).status !== "active");
        // An explicitly headless session can be inspected before loading it. Codex's
        // writer lock still arbitrates ownership when thread/resume runs at dispatch.
        if (this.mode === "stdio" && object(thread.status).type === "notLoaded") {
            thread.status = { type: "idle" };
        }
        return normalizeSnapshot(meta, turns.data[0], thread, false);
    }

    async quota(bucket?: string): Promise<QuotaSnapshot> {
        return normalizeQuota(await this.rpc.call("account/rateLimits/read"), bucket, Date.now());
    }

    async continue(threadId: string, message: string, expected: ThreadSnapshot): Promise<string> {
        uuid(threadId);
        if (!(await this.listConversations()).some((entry) => entry.id === threadId)) {
            throw new Error("Conversation was archived or removed before dispatch");
        }
        const fresh = await this.inspect(threadId);
        if (!unchanged(fresh, expected.turnId, expected.fingerprint)) {
            throw new Error("Conversation changed before dispatch");
        }
        if (this.mode === "desktop") {
            if (!this.queueChecked) {
                const help = await run(this.binary, ["queue", "--help"], {
                    timeout: 10_000,
                    windowsHide: true,
                    maxBuffer: 1024 * 1024,
                });
                if (!help.stdout.includes("--thread") || !help.stdout.includes("--message")) {
                    throw new Error("Installed Codex does not support exact-thread queue delivery");
                }
                this.queueChecked = true;
            }
            const receipt = await run(
                this.binary,
                ["queue", "--thread", threadId, "--message", message],
                {
                    timeout: 30_000,
                    windowsHide: true,
                    maxBuffer: 1024 * 1024,
                    env: { ...process.env, CODEX_HOME: this.home },
                },
            );
            if (
                !new RegExp(`^Queued message [0-9a-f-]{36} for thread ${threadId}\\.$`, "i").test(
                    receipt.stdout.trim(),
                )
            ) {
                throw new Error("Queue receipt was not recognized");
            }
            // A queue receipt is acceptance, not proof that the turn started.
            for (let attempt = 0; attempt < 10; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                const next = await this.inspect(threadId);
                if (
                    next.turnId &&
                    next.turnId !== expected.turnId &&
                    next.continuationId === `${threadId}:${expected.turnId}`
                ) {
                    return next.turnId;
                }
            }
            throw new Error("Queued message accepted but continuation not confirmed");
        }
        if (this.mode === "stdio") {
            await this.rpc.call("thread/resume", { threadId, excludeTurns: true });
            const loaded = await this.inspect(threadId);
            if (!unchanged(loaded, expected.turnId, expected.fingerprint)) {
                throw new Error("Headless session changed while being loaded");
            }
        }
        const result = object(
            await this.rpc.call("turn/start", {
                threadId,
                input: [{ type: "text", text: message, text_elements: [] }],
            }),
        );
        const turn = object(result.turn);
        if (
            !text(turn.id) ||
            turn.id === expected.turnId ||
            !["inProgress", "completed", "failed"].includes(text(turn.status))
        ) {
            throw new Error("Codex did not confirm a new continuation turn");
        }
        return text(turn.id);
    }

    async diagnostics(bucket?: string): Promise<Record<string, unknown>> {
        const version = await run(this.binary, ["--version"], {
            timeout: 10_000,
            windowsHide: true,
        });
        const threads = await this.listConversations();
        const quota = await this.quota(bucket);
        return {
            binary: this.binary,
            version: version.stdout.trim(),
            connection: this.mode,
            codexHome: this.home,
            conversations: threads.length,
            quota,
        };
    }

    async close(): Promise<void> {
        await this.rpc.close();
    }
}
