import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { WatchConversations } from "../../../application/recovery/watch-conversations.ts";
import { matchesProject, type createRuntime } from "../../../composition/create-runtime.ts";
import type { parseArguments } from "../arguments.ts";

export async function runWatcher(
    runtime: ReturnType<typeof createRuntime>,
    options: ReturnType<typeof parseArguments>,
    controller: AbortController,
): Promise<void> {
    const owner = randomUUID();
    if (!runtime.store.acquireLease(owner, Date.now())) {
        throw new Error("Another watcher is already using this state directory");
    }
    const heartbeat = setInterval(() => {
        try {
            if (!runtime.store.acquireLease(owner, Date.now())) {
                throw new Error("Watcher lease was lost");
            }
        } catch {
            runtime.events.write({
                at: Date.now(),
                kind: "attention",
                message: "Watcher lease could not be renewed; stopping",
            });
            process.exitCode = 1;
            controller.abort();
        }
    }, 15_000);
    try {
        for (const entry of runtime.store
            .recoveries()
            .filter((recovery) => recovery.status === "dispatching")) {
            runtime.store.update(
                entry.id,
                "attention",
                "Watcher stopped during dispatch; delivery must be checked manually",
                Date.now(),
            );
        }
        const watcher = new WatchConversations(
            runtime.codex,
            runtime.store,
            runtime.clock,
            runtime.events,
            {
                scope: options.scope,
                bucket: options.bucket,
                dryRun: options.dryRun,
                maxWhips: options.maxWhips,
                staggerMs: 10_000,
                matchesProject,
                shouldStop: () => controller.signal.aborted,
            },
        );
        const selection = options.scope.all
            ? "all projects"
            : `${options.scope.projects.length} projects · ${options.scope.threads.length} selected chats`;
        runtime.events.write({
            at: Date.now(),
            kind: "watch",
            message: `${options.dryRun ? "DRY RUN · " : ""}${options.connection} · ${selection} · checking every ${options.intervalMs / 1000}s · Ctrl+C to stop`,
        });
        do {
            try {
                await watcher.tick();
            } catch (error) {
                watcher.reportConnectionError(error);
                if (options.once) {
                    process.exitCode = 1;
                }
            }
            if (options.once || controller.signal.aborted) {
                break;
            }
            try {
                await delay(options.intervalMs, undefined, { signal: controller.signal });
            } catch {
                break;
            }
        } while (!controller.signal.aborted);
        runtime.events.write({
            at: Date.now(),
            kind: "stop",
            message: "Watcher stopped; pending recoveries remain persisted",
        });
    } finally {
        clearInterval(heartbeat);
        runtime.store.releaseLease(owner);
    }
}
