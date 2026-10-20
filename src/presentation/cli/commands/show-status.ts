import type { RecoveryStore } from "../../../application/ports/recovery-store.ts";
import { clean } from "../event-logger.ts";

export function showStatus(store: RecoveryStore, directory: string, json: boolean): void {
    const now = Date.now();
    const entries = store.recoveries();
    const confirmed = entries.filter((entry) => entry.status === "confirmed");
    const today = new Date(now).toDateString();
    const waiting = entries.filter((entry) => entry.status === "waiting");
    const issues = store.issues();
    const attention = new Set([
        ...entries
            .filter((entry) => entry.status === "attention" || entry.status === "dispatching")
            .map((entry) => entry.threadId),
        ...issues.map((issue) => issue.key),
    ]);
    const status = {
        paused: store.paused(),
        watcher: store.watcherRunning(now) ? "running" : "stopped",
        stateDir: directory,
        totalWhips: confirmed.length,
        whipsToday: confirmed.filter((entry) => new Date(entry.updatedAt).toDateString() === today)
            .length,
        lastWhip: confirmed.reduce<number | null>(
            (last, entry) => Math.max(last ?? 0, entry.updatedAt),
            null,
        ),
        waiting: waiting.length,
        needsAttention: attention.size,
        inspectionIssues: issues,
        nextCheck: waiting.length ? Math.min(...waiting.map((entry) => entry.dueAt)) : null,
        recoveries: entries,
    };
    if (json) {
        process.stdout.write(`${JSON.stringify(status)}\n`);
        return;
    }
    const rows = entries
        .slice(0, 20)
        .map(
            (entry) =>
                `${entry.status.padEnd(11)} ${entry.threadId}  ${clean(entry.title)}\n            ${clean(entry.project)} · ${clean(entry.reason)}`,
        )
        .join("\n");
    process.stdout.write(
        [
            `Harness Whip · ${status.watcher}${status.paused ? " · PAUSED" : ""}`,
            "",
            `Total whips: ${status.totalWhips} · Today: ${status.whipsToday} · Waiting: ${status.waiting} · Attention: ${status.needsAttention}`,
            `Last whipped: ${status.lastWhip ? new Date(status.lastWhip).toLocaleString() : "never"}`,
            `Next check: ${status.nextCheck ? new Date(status.nextCheck).toLocaleString() : "none"}`,
            ...(issues.length
                ? [
                      `Inspection issues: ${issues.length} · some conversations cannot be recovered automatically`,
                      ...issues
                          .slice(0, 5)
                          .map((issue) => `  ${clean(issue.key)} · ${clean(issue.reason)}`),
                      ...(issues.length > 5
                          ? ["  Run harness-whip status --json for all inspection issues."]
                          : []),
                  ]
                : []),
            "",
            rows || "No recoveries recorded.",
            "",
        ].join("\n"),
    );
}
