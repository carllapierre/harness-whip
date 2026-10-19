export type TurnStatus = "inProgress" | "completed" | "interrupted" | "failed" | "unknown";

export interface Conversation {
    id: string;
    title: string;
    project: string;
    updatedAt: number;
    ephemeral: boolean;
    parentId: string | null;
}

export interface ThreadSnapshot extends Conversation {
    turnId: string;
    turnStartedAt: number | null;
    turnStatus: TurnStatus;
    quotaFailure: boolean;
    runtime: "active" | "idle" | "systemError" | "notLoaded" | "unknown";
    blocked: boolean;
    blockedReason: string | null;
    fingerprint: string;
    continuationId: string | null;
}

export interface UsageWindow {
    usedPercent: number;
    resetsAt: number;
    durationMinutes: number;
}

export interface QuotaSnapshot {
    bucket: string;
    windows: UsageWindow[];
    allowed: boolean;
    observedAt: number;
}

export type RecoveryStatus = "waiting" | "dispatching" | "confirmed" | "canceled" | "attention";

export interface Recovery {
    id: string;
    threadId: string;
    failedTurnId: string;
    project: string;
    title: string;
    fingerprint: string;
    status: RecoveryStatus;
    dueAt: number;
    createdAt: number;
    updatedAt: number;
    reason: string;
    confirmation: string | null;
}

export interface Activity {
    id?: number;
    at: number;
    kind: string;
    message: string;
    threadId?: string;
    recoveryId?: string;
}

export interface MonitoringIssue {
    key: string;
    reason: string;
    observedAt: number;
}

export interface WatchScope {
    all: boolean;
    projects: string[];
    threads: string[];
    excludedThreads: string[];
}

export const CONTINUATION =
    "Continue the unfinished work interrupted by the usage limit. Check existing progress and " +
    "completed actions before proceeding. Preserve the original task scope, instructions, " +
    "execution settings, and approval requirements. If the task is finished or needs a user " +
    "decision, explain that and stop.";
