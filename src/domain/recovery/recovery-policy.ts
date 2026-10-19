import type { QuotaSnapshot, ThreadSnapshot } from "./recovery-model.ts";

export function eligible(snapshot: ThreadSnapshot): boolean {
    return (
        !snapshot.ephemeral &&
        !snapshot.parentId &&
        !snapshot.blocked &&
        snapshot.turnId.length > 0 &&
        snapshot.turnStatus === "failed" &&
        snapshot.quotaFailure &&
        (snapshot.runtime === "idle" || snapshot.runtime === "systemError")
    );
}

export function quotaDecision(
    quota: QuotaSnapshot,
    now: number,
): { ready: boolean; nextCheck: number; reason: string } {
    const retry = now + 60_000;
    if (!quota.windows.length || now - quota.observedAt > 60_000) {
        return { ready: false, nextCheck: retry, reason: "Quota data unavailable or stale" };
    }
    for (const window of quota.windows) {
        if (
            !Number.isFinite(window.usedPercent) ||
            window.usedPercent < 0 ||
            window.usedPercent > 100 ||
            !Number.isFinite(window.resetsAt) ||
            window.resetsAt <= 0 ||
            !Number.isFinite(window.durationMinutes) ||
            window.durationMinutes <= 0
        ) {
            return { ready: false, nextCheck: retry, reason: "Unrecognized quota window" };
        }
    }
    const exhausted = quota.windows.filter((window) => window.usedPercent >= 100);
    if (exhausted.length) {
        return {
            ready: false,
            nextCheck: Math.max(retry, ...exhausted.map((window) => window.resetsAt + 15_000)),
            reason: "Waiting for the exhausted usage windows to reset",
        };
    }
    if (!quota.allowed || quota.windows.some((window) => window.resetsAt <= now)) {
        return { ready: false, nextCheck: retry, reason: "Capacity has not been confirmed" };
    }
    return { ready: true, nextCheck: now, reason: "Capacity available" };
}

export function unchanged(snapshot: ThreadSnapshot, turnId: string, fingerprint: string): boolean {
    return eligible(snapshot) && snapshot.turnId === turnId && snapshot.fingerprint === fingerprint;
}
