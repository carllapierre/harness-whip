import { createHash } from "node:crypto";
import type {
    Conversation,
    QuotaSnapshot,
    ThreadSnapshot,
    TurnStatus,
    TurnObservation,
} from "../../domain/recovery/recovery-model.ts";
import { array, canonical, numeric, object, text } from "./protocol-values.ts";

export function conversation(value: unknown): Conversation {
    const thread = object(value);
    if (!text(thread.id) || !text(thread.cwd)) {
        throw new Error("Codex conversation metadata is incomplete");
    }
    return {
        id: text(thread.id),
        title: text(thread.name, "Untitled conversation"),
        project: text(thread.cwd),
        updatedAt: numeric(thread.updatedAt, 0) * 1000,
        ephemeral: thread.ephemeral !== false,
        parentId: typeof thread.parentThreadId === "string" ? thread.parentThreadId : null,
    };
}

export function latestDesktopTurn(value: unknown): Record<string, unknown> {
    const state = object(value);
    const history = object(state.turnHistory);
    if (history.kind === "canonical") {
        const canonicalHistory = object(history.history);
        const tail = object(array(canonicalHistory.islands).at(-1));
        if (object(tail.newerBoundary).status !== "exhausted") {
            throw new Error("Desktop conversation history is incomplete");
        }
        const key = text(object(array(tail.entries).at(-1)).value);
        return object(object(canonicalHistory.entitiesByKey)[key]);
    }
    if (Array.isArray(state.turns)) {
        return object(state.turns.at(-1));
    }
    throw new Error("Desktop history format is unsupported");
}

export function normalizeObservation(
    meta: Conversation,
    turnValue: unknown,
    desktop = false,
): TurnObservation {
    const turn = object(turnValue);
    const turnStatus = ["inProgress", "completed", "interrupted", "failed"].includes(
        text(turn.status),
    )
        ? (text(turn.status) as TurnStatus)
        : "unknown";
    const errorInfo = object(turn.error).codexErrorInfo;
    const userText = array(turn.items)
        .filter((item) => object(item).type === "userMessage")
        .flatMap((item) => array(object(item).content))
        .map((part) => text(object(part).text))
        .join("\n");
    return {
        ...meta,
        turnId: text(turn.id, text(turn.turnId)),
        turnStartedAt: desktop
            ? typeof turn.turnStartedAtMs === "number"
                ? turn.turnStartedAtMs
                : null
            : typeof turn.startedAt === "number"
              ? turn.startedAt * 1000
              : null,
        turnStatus,
        quotaFailure: errorInfo === "usageLimitExceeded" || errorInfo === "UsageLimitExceeded",
        continuationId:
            /\[(?:harness-whip|codex-whip):([0-9a-f:-]+)\]/i.exec(userText)?.[1] ?? null,
    };
}

export function normalizeSnapshot(
    meta: Conversation,
    turnValue: unknown,
    stateValue: unknown,
    desktop: boolean,
): ThreadSnapshot {
    const turn = object(turnValue);
    const state = object(stateValue);
    const runtime = text(object(desktop ? state.threadRuntimeStatus : state.status).type);
    const goal = object(state.threadGoal);
    // thread/read is authoritative for persistence. Desktop IPC may omit the
    // optional ephemeral field; an explicit conflicting or unknown value still blocks.
    const blockers = desktop
        ? [
              state.hostId !== "local" && "Desktop host is not local",
              (meta.ephemeral || (state.ephemeral !== undefined && state.ephemeral !== false)) &&
                  "Conversation persistence is not confirmed",
              state.resumeState !== "resumed" && "Desktop conversation is not resumed",
              (!Array.isArray(state.requests) || array(state.requests).length > 0) &&
                  "Desktop approval or user input is pending or unavailable",
              (!Array.isArray(state.queuedFollowUps) || array(state.queuedFollowUps).length > 0) &&
                  "Queued messages are pending or unavailable",
              (!!state.threadGoalResumeConfirmation ||
                  (state.threadGoal != null && goal.status !== "active")) &&
                  "Goal needs confirmation or is not active",
              array(object(state.threadRuntimeStatus).activeFlags).length > 0 &&
                  "Desktop runtime has active blockers",
          ]
        : [
              (array(object(state.status).activeFlags).length > 0 || state.blocked === true) &&
                  "Runtime, queued message, goal, or approval blocks continuation",
          ];
    const blockedReason = blockers.filter(Boolean).join("; ") || null;
    const settings = desktop
        ? {
              cwd: state.cwd,
              model: state.latestModel,
              reasoning: state.latestReasoningEffort,
              permissions: state.currentPermissions,
              settings: state.latestThreadSettings,
              collaboration: state.latestCollaborationMode,
              goal: state.threadGoal,
          }
        : {
              cwd: meta.project,
              model: state.model,
              reasoning: state.reasoningEffort,
              goal: state.threadGoal,
          };
    return {
        ...normalizeObservation(meta, turnValue, desktop),
        runtime: ["active", "idle", "systemError", "notLoaded"].includes(runtime)
            ? (runtime as ThreadSnapshot["runtime"])
            : "unknown",
        blocked: blockedReason !== null,
        blockedReason,
        fingerprint: createHash("sha256")
            .update(
                canonical({
                    turnId: turn.id ?? turn.turnId,
                    status: turn.status,
                    error: turn.error,
                    settings,
                }),
            )
            .digest("hex"),
    };
}

export function normalizeQuota(
    value: unknown,
    bucketId: string | undefined,
    now: number,
): QuotaSnapshot {
    const response = object(value);
    const buckets = object(response.rateLimitsByLimitId);
    const ids = Object.keys(buckets);
    if (ids.length > 1 && !bucketId) {
        throw new Error("Multiple usage buckets returned; choose --limit-id explicitly");
    }
    const id = bucketId ?? ids[0] ?? text(object(response.rateLimits).limitId, "codex");
    const bucket = ids.length ? object(buckets[id]) : object(response.rateLimits);
    if (!Object.keys(bucket).length || (bucket.limitId && bucket.limitId !== id)) {
        throw new Error("The selected quota bucket is unavailable");
    }
    const reached = bucket.rateLimitReachedType;
    return {
        bucket: id,
        observedAt: now,
        allowed:
            response.ordinaryUsageAllowed !== false &&
            !reached &&
            !bucket.spendControlReached &&
            bucket.individualLimit == null,
        windows: [bucket.primary, bucket.secondary]
            .filter((window) => window != null)
            .map((window) => {
                const row = object(window);
                return {
                    usedPercent: numeric(row.usedPercent),
                    resetsAt: numeric(row.resetsAt) * 1000,
                    durationMinutes: numeric(row.windowDurationMins),
                };
            }),
    };
}
