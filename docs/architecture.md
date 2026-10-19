# Architecture

Codex Whip is one deployable TypeScript CLI. Directories describe the recovery
workflow. Production has no npm runtime dependencies; it uses Node's process,
stream, socket, SQLite and argument-parsing APIs. Developer tooling stays in
devDependencies. Distributed JavaScript runs without a TypeScript loader.

## Follow a quota failure

1. `presentation/cli/arguments.ts` parses the watch scope and execution options.
2. `composition/create-runtime.ts` wires the Codex adapter, SQLite store, clock and logger.
3. `application/recovery/watch-conversations.ts` discovers selected conversations,
   establishes baselines, records failures and coordinates due recoveries.
4. `domain/recovery/recovery-policy.ts` decides eligibility, quota availability and
   whether a conversation still matches a recorded failure. It has no I/O or clock reads.
5. `application/ports` describes exactly the external behavior that recovery needs.
6. `infrastructure/codex` implements the protocol, state normalization, desktop
   snapshots and delivery. `infrastructure/persistence` owns SQL and migrations.
7. `presentation/cli/event-logger.ts` renders domain events as terminal lines or JSON.

```text
src/
    domain/recovery/              Recovery states and pure policies
    application/recovery/         Observe, schedule, recheck and dispatch
    application/ports/            Codex, recovery store, clock and event contracts
    infrastructure/codex/         Protocol transport and state normalization
    infrastructure/persistence/   SQLite ledger and watcher lease
    presentation/cli/             Commands, status and event output
    composition/                  Explicit runtime wiring
migrations/                       Versioned SQL
tests/                            Behavior and protocol tests
```

Domain code cannot import application, adapters, presentation, Node modules or
composition. Application code cannot import infrastructure, presentation, Node
modules or composition. ESLint enforces these restrictions. Constructor injection
uses ordinary TypeScript; there is no dependency-injection container.

## Persistent recovery lifecycle

```text
waiting -> dispatching -> confirmed
   |            |
   |            +-----> attention
   +------------------> canceled
```

`waiting` means an eligible failure is recorded. `dispatching` is written before
the first send attempt; only one atomic SQL update can claim it. On restart,
leftover dispatching entries become attention entries. A unique constraint on
thread ID and failed turn ID makes canceled, confirmed and uncertain entries
terminal for that failure. We never delete the ledger to enable a retry.

There is no lifetime whip budget. Each distinct eligible quota failure can be
recovered once. An upgrade returns records blocked solely by the retired budget
guard to waiting only when no dispatch event or confirmation exists; the usual
quota, scope and conversation rechecks still apply.

Pause/exclusion checks participate in the same SQL update as the dispatch claim.
The claim also verifies the watcher's current lease owner and expiry, so a
resumed process cannot send using a lease that another process took over.
A renewable SQLite lease limits one state directory to one watcher. It is not a
distributed lock across unrelated databases. The heartbeat is every 15 seconds,
with a two-minute expiry for crash recovery.

Scope selection occurs before inspection. Project paths are canonicalized when
possible and compared using directory boundaries. Separate worktrees need an
explicit selected path when outside the selected project directory. Broad-scope
baselines persist across restarts. Individual UUID selection can enroll an old
quota failure deliberately.

A turn that started after the watcher launched can qualify even when its first
observation is already a quota failure. Its structured start timestamp distinguishes
that case from an old failure; missing timestamps keep the conservative baseline.

## Codex boundary

The official app-server discovers threads and reads quota. Desktop mode combines
those reads with live version-11 IPC snapshots, then uses the official queue CLI.
It verifies a unique recovery marker in the new turn's user message before counting
a whip. Internal desktop IPC remains experimental and isolated to one adapter.

Proxy mode uses an existing server's runtime state. Stdio mode owns its child server
and resumes headless sessions only when dispatch is due. Neither mode changes
authentication, model, sandbox or approval configuration. Approval/input/tool RPC
requests receive an unsupported response, and that thread is blocked from further
automatic recovery in the process. Whip never fabricates tool results or user answers.

Quota windows are whatever the selected account bucket returns. Five hours is not
hardcoded. Reset timestamps are milliseconds internally and are converted from
protocol Unix seconds at the adapter boundary. Missing capacity is not zero usage.
Pending recoveries reread quota at most 30 seconds apart, including before a
reported reset, so manually restored capacity can be detected early.

The official metadata confirms whether a chat is ephemeral; desktop IPC may omit
that optional flag. Explicit conflicting flags still block recovery. Failed
inspections and blocked quota failures persist separately from recovery records,
so `status` can expose problems even when the recovery ledger is empty.

## Deliberate limits

- One package and process; no web UI, hosted backend, message broker or service split.
- SQLite with SQL migrations; no ORM for the small ledger.
- Ordinary timers and persisted due times; no scheduler framework or model polling loop.
- No settings framework, generic repository base class or plugin registry.
- New abstractions need an actual external boundary or a concrete testing need.
- Keep dependencies justified by behavior and measured complexity.

Status aggregates the ledger on demand. Introduce pagination, retention or finer
queries when actual history sizes justify them. The finite app-server child can
use more memory than Whip itself; zero npm dependencies is not a total-memory claim.
