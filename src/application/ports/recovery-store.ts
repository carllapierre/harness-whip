import type { Activity, MonitoringIssue, Recovery } from "../../domain/recovery/recovery-model.ts";

export interface RecoveryStore {
    recoveries(): Recovery[];
    add(recovery: Recovery): boolean;
    update(
        id: string,
        status: Recovery["status"],
        reason: string,
        at: number,
        dueAt?: number,
        confirmation?: string,
    ): void;
    claim(id: string, at: number): boolean;
    seen(threadId: string): string | null;
    markSeen(threadId: string, turnId: string): void;
    issues(): MonitoringIssue[];
    setIssue(issue: MonitoringIssue): void;
    clearIssue(key: string): void;
    excluded(threadId: string): boolean;
    exclude(threadId: string, value: boolean): void;
    paused(): boolean;
    watcherRunning(now: number): boolean;
    pause(value: boolean): void;
    record(event: Activity): void;
    history(limit: number): Activity[];
    close(): void;
}
