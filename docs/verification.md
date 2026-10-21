# Verification and compatibility

Run `npm run check` for types, lint, formatting, behavioral tests and production build.
`npm pack --dry-run` checks the installable file list. Tests never call a live model.

## Automated coverage

- Quota enum classification, unknown/stale quota and later exhausted reset windows.
- Canonical desktop history completeness and correlation markers.
- Omitted optional desktop flags with authoritative persisted metadata, blocked
  failure visibility, early manual resets and upgrading existing state databases.
- Baseline historical failures and an observed running turn failing under the same ID.
- Manual continuation, interruption, archival, changed settings and pending input.
- Final-check races, pause/exclusion at claim time and shutdown before dispatch.
- Uncertain delivery, repeated distinct quota failures without a conversation cap,
  and upgrading budget-blocked recoveries while preserving recorded sends.
- Actual SQLite reopen, durable intent, deduplication, two database connections
  competing for one claim and watcher lease expiry.
- RPC request correlation, timeouts, disconnects, and refusing approval requests.
- Fragmented desktop IPC frames, Unicode, unsupported protocol versions, and
  headless adapter dispatch preserving inherited execution settings.
- Snapshots larger than 32 MiB, coalesced frames and invalid/oversized frame
  headers, plus status prioritization for blocked waiting recoveries.
- CLI validation, path boundaries and terminal control-character sanitization.
- Summary-only ordinary monitoring, bounded cache refresh, no repeated desktop
  snapshots while quota is exhausted, and live rechecks after lightweight signals.
- Database-only discovery with periodic reconciliation, retention/removal of
  rollout-only chats, pagination, compatibility fallback, and uncached archival
  verification before dispatch. Cold metadata caching still invalidates on changes.

## Live verification

Read-only integration was checked on Windows with the desktop's native
`codex-cli 0.163.0-alpha.10.2`: initialization, paginated thread discovery, thread
metadata, turn-history reads, quota reads, queue reads and version-11 desktop
snapshot transport. The separate global CLI `0.104.0` lacks `queue` and is unsuitable
for this desktop adapter. `doctor --thread UUID` checks the full live inspection path.

On 2026-10-18, a real desktop quota failure exposed an eligibility bug: IPC omitted
the optional `ephemeral` flag while official metadata confirmed a persisted chat.
Whip silently rejected it, and status omitted that rejection. After fixing both,
the background watcher recorded the existing observed failure, read available
capacity after the user had manually reset their account, submitted exactly one
continuation and confirmed its marker in the same chat's new active turn.

Natural scheduled-reset recovery, full headless execution, macOS recovery
dispatch, Linux live integration and cloud sandbox lifecycle remain unverified. Early reset polling
has regression coverage; the live incident verified recovery after restored
capacity, rather than waiting out a complete exhausted window.

On 2026-10-21, the same long-running chat exposed a transport ceiling: its
37,555,032-byte snapshot exceeded Whip's old 32 MiB frame limit. The waiting
recovery remained recorded, but inspection had failed since the previous evening.
After increasing the bound to 128 MiB and replacing repeated buffer concatenation
with chunk assembly, read-only inspection of the real chat succeeded. Its latest
turn was already active following the user's manual continuation; this repair
did not send another message. Synthetic coverage exercises a 33 MiB snapshot.

Later on 2026-10-21, live measurement showed that repeatedly requesting desktop
history was unnecessary for monitoring. The watcher Node process sampled at
271.4 MiB working set. Monitoring now reads only newest-turn metadata with
`itemsView: notLoaded`, caches unchanged results for at most 30 seconds, and uses
desktop snapshots for initial failure validation and final recovery checks.
An existing confirmed continuation's marker was successfully read through the
uncached official summary path used for delivery confirmation.

A read-only scan of 71 root chats transferred 155,782 bytes across the listing
and turn metadata responses, with zero desktop snapshot calls. The following
scan reused cached observations except for one updated chat. The probe Node
process sampled at 36.5–37.0 MiB; the migrated watcher sampled at 36.4 MiB, with
its separate Codex helper at 77.6 MiB. These are point-in-time samples, not a
controlled benchmark or proof that all desktop lag was caused by Whip.

The Windows installation was migrated to the **Harness Whip** sign-in task and
`~/.harness-whip/`. A paused-watcher database backup and pre/post-move checksums
verified all 11 recovery records, including eight confirmed continuations,
baselines, exclusions and settings. Existing logs were preserved. The new global
command and legacy alias resolved to the same migrated database; the old task
was removed after the new watcher was verified running. No new continuation
was submitted during the monitoring/migration verification.

The next discovery optimization was checked with a real 30-second interval.
Startup performed database discovery plus a full reconciliation and turn metadata
reads: 71 chats, 3,367 ms, and 276,428 response bytes. The following scan used one
database listing and 16 turn metadata reads: 55 ms and 128,528 bytes, with the exact
same 71 chat IDs and no full scan or desktop snapshot. The rollout-only chat was
retained. These samples include caching and are not a controlled benchmark.
Five-minute reconciliation/removal, complete pagination, unsupported-option
fallback and archival rejection before dispatch have behavioral tests. This
discovery optimization was verified live on Windows; its macOS path was not
retested live during this change.

The default proxy socket did not connect on the inspected Windows installation.
Proxy mode requires a deliberately running compatible shared server. Desktop mode
uses its own snapshot channel, so that probe does not block desktop reads.

The previously verified Windows development setup included a user-requested
sign-in task running the watcher. Installation elsewhere does not register a startup task.
Whip does not redeem account resets or configure a paid API fallback.

## macOS evidence (2026-10-19)

Checked on **macOS 26.7 (25G229), Apple Silicon arm64**, using **Node 22.19.0**
and the ChatGPT app's bundled **codex-cli 0.162.0-alpha.2**.

- Found and fixed a discovery gap: this runtime lives under
  `ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`,
  rather than directly in `Resources`. System and user Applications folders are
  now searched. Explicit paths are checked for executable permissions on Unix.
- `doctor` completed with automatic discovery: initialization, paginated thread
  discovery and account quota reads succeeded.
- Read-only inspection of a loaded conversation in this checkout succeeded:
  official thread metadata and queue reads plus a version-11 desktop snapshot
  over the default Unix socket agreed on the exact thread.
- `watch --project . --dry-run --once` completed successfully with isolated test
  state. It observed an active conversation; no quota failure was induced and
  no continuation was submitted.
- The bundled runtime's `queue --help` exposes `--thread` and `--message`.
  This verifies command availability, not successful delivery.
- The terminal initially selected Node 20.20.1, below the minimum. A launcher
  version check now reports Node 22.18+ explicitly; `.nvmrc` selects Node 22.
- `npm run check` passed locally on Node 22.19.0: typecheck, lint, formatting,
  all 47 behavioral tests and production build. `npm pack --dry-run` included
  both executable names, compiled modules and migrations, with no runtime
  database, credentials or conversation payloads in the package.

No real quota reset, recovery send, background startup, sleep/wake cycle, Intel
Mac, or full headless execution has been verified on macOS. Existing CI declares
macOS, Windows and Ubuntu jobs on Node 22/24; a declared matrix alone does not
establish that a particular hosted run passed.

## Before advertising a tested platform

Use a disposable task. Observe a structured quota failure, wait for the reported
reset, and verify exactly one continuation in the same thread. Check interruption,
pause, manual resume, a process restart and stale dispatch intent. Record the OS,
Codex version, Node version and result; never commit private conversation content.
