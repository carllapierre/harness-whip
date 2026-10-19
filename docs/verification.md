# Verification and compatibility

Run `npm run check` for types, lint, formatting, behavioral tests and production build.
`npm pack --dry-run` checks the installable file list. Tests never call a live model.

## Automated coverage

- Quota enum classification, unknown/stale quota and later exhausted reset windows.
- Canonical desktop history completeness and correlation markers.
- Baseline historical failures and an observed running turn failing under the same ID.
- Manual continuation, interruption, archival, changed settings and pending input.
- Final-check races, pause/exclusion at claim time and shutdown before dispatch.
- Uncertain delivery and cumulative per-conversation attempt limits.
- Actual SQLite reopen, durable intent, deduplication, two database connections
  competing for one claim and watcher lease expiry.
- RPC request correlation, timeouts, disconnects, and refusing approval requests.
- Fragmented desktop IPC frames, Unicode, unsupported protocol versions, and
  headless adapter dispatch preserving inherited execution settings.
- CLI validation, path boundaries and terminal control-character sanitization.

## Live verification

Read-only integration was checked on Windows with the desktop's native
`codex-cli 0.163.0-alpha.10.2`: initialization, paginated thread discovery, thread
metadata, turn-history reads, quota reads, queue reads and version-11 desktop
snapshot transport. The separate global CLI `0.104.0` lacks `queue` and is unsuitable
for this desktop adapter. `doctor --thread UUID` checks the full live inspection path.

Not yet verified against a real quota-reset cycle: desktop dispatch and its
continuation marker, full headless execution, macOS/Linux live integration, or
cloud sandbox lifecycle. Protocol and engine behavior have synthetic tests;
that evidence is narrower than a real overnight integration result.

The default proxy socket did not connect on the inspected Windows installation.
Proxy mode requires a deliberately running compatible shared server. Desktop mode
uses its own snapshot channel, so that probe does not block desktop reads.

No existing conversation was sent a continuation during development. No background
watcher, operating-system scheduled task, account setting or paid API fallback was
installed automatically. A long-lived watcher must be started explicitly.

## Before advertising a tested platform

Use a disposable task. Observe a structured quota failure, wait for the reported
reset, and verify exactly one continuation in the same thread. Check interruption,
pause, manual resume, a process restart and stale dispatch intent. Record the OS,
Codex version, Node version and result; never commit private conversation content.
