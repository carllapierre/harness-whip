# Running as a process

Start with `doctor`, then `watch --dry-run`. Run foreground initially so you can
see connection errors and inspect `status`. The process remains active until
SIGINT/SIGTERM, even when there is no pending work.

## Install the command

From a source checkout, run `npm ci`, `npm run build`, then `npm link`.
This links the package's `harness-whip` executable into npm's global command directory.
Keep the checkout in place and rebuild after source changes; the linked command
uses that build from any working directory. Remove the link with
`npm uninstall --global harness-whip`.

For a standalone installation, run `npm pack`, then
`npm install --global ./harness-whip-0.1.0.tgz`. The installed package has no runtime
npm dependencies. This project has not been published to the npm registry.

If the command is not found, check `npm prefix --global`: add that directory to
PATH on Windows, or its `bin` subdirectory on macOS/Linux, then open a new terminal.

## Upgrading from Codex Whip

The package and primary command are now `harness-whip`. The `codex-whip` command
remains an alias, and existing `bin/codex-whip.mjs` launchers still work. Rebuild
and rerun `npm link` after upgrading a linked checkout.

Without a state override, Harness Whip reuses `~/.codex-whip/whip.sqlite` when it
exists. This preserves pause/exclusions, observed baselines, recovery history,
uncertain dispatch protection and the existing watcher lease. If both old and
new default databases exist, choose the authoritative one with `--state-dir`;
Whip will refuse to guess. Do not start separate watchers against both databases.
Existing recovery markers remain recognizable. There is no automatic directory
move, database copy or startup-task change.

## macOS

Use Node 22.18+; with nvm, `nvm install && nvm use` reads this checkout's `.nvmrc`.
Run `node --version` in the terminal that will launch Whip. An older Node prints
an actionable error before loading SQLite. Build, link and run foreground first:

```sh
harness-whip doctor
harness-whip list --project .
harness-whip doctor --thread UUID
harness-whip watch --project . --dry-run --once
harness-whip watch --project .
```

Automatic discovery checks `/Applications` and `~/Applications` for ChatGPT/Codex,
including `Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`, then PATH.
A standalone CLI may lack the desktop queue API; prefer the app's bundled runtime.
For moved or renamed apps, use `--codex /absolute/path/to/codex`.
Desktop snapshots use `$CODEX_HOME/ipc/ipc.sock` (default `~/.codex/ipc/ipc.sock`);
`--socket PATH` overrides it. Keep the app and selected chat loaded.

The watcher cannot run while the Mac sleeps. For an unattended foreground session,
`caffeinate -i harness-whip watch --project /absolute/project/path` prevents idle
system sleep while the command runs. No macOS startup agent is installed. If you
configure a user LaunchAgent yourself, use absolute Node and launcher paths;
launchd does not load nvm's interactive shell configuration. Keep the same state
directory and allow at least two minutes before restarting a crashed watcher.
See [verification](verification.md) for the checks actually performed.

## Controls and scope

`watch --project PATH` includes descendants of the selected directory. Repeat the
option for other projects or separate worktrees. Subagent and ephemeral sessions
are excluded. `--thread UUID` explicitly selects a conversation and can enroll an
existing quota failure; broad scopes baseline failures already present.

`history --limit 50` shows recent events. `cancel --thread UUID` excludes a chat
and cancels its waiting recovery; `include --thread UUID` removes that exclusion.
Canceled or uncertain recovery records are not automatically retried for the same
failed turn. A later distinct quota failure can qualify.

There is no per-conversation whip cap. Each distinct quota failure can qualify;
recoveries are staggered by at least ten seconds.
New installations default to `~/.harness-whip/whip.sqlite`. State overrides are
`--state-dir`, then `HARNESS_WHIP_HOME`, then the legacy `CODEX_WHIP_HOME`. Use the
same state directory for watchers and controls. `status` counts confirmed new
continuation turns; it does not claim the underlying work finished.
Its running indicator confirms the watcher lease. Inspection issues and blocked
quota failures also count as attention, even when no recovery has been recorded.
With `--all`, unloaded desktop chats can produce inspection issues; use
`doctor --thread UUID` to check a particular chat. `status --json` includes all
issue reasons and timestamps. Successful inspection clears a resolved issue.

Waiting recoveries reread quota every 30 seconds, so a manual reset can release
them before the original reset timestamp. Whip does not redeem account resets.

Desktop mode uses experimental live IPC snapshots and the installed runtime's
official queue command. `proxy` attaches to an existing shared app-server with
`--socket PATH`. `stdio` owns a child server for headless work. It cannot answer
approval requests, user questions or client-provided tool requests.

`--json` emits one JSON object per line; errors go to stderr. Color is enabled
only for a terminal and honors `NO_COLOR` and `--no-color`. Use `--codex PATH`,
`--codex-home PATH` or `--limit-id ID` to select a runtime, history or usage bucket.
See `--help` for the full command reference.

## Linux systemd example

After installing/building your checkout, adapt absolute paths for your machine:

```ini
[Unit]
Description=Harness Whip quota recovery
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/you/harness-whip
ExecStart=/usr/bin/node /home/you/harness-whip/bin/harness-whip.mjs watch --connection stdio --project /workspace/project --json
Environment=CODEX_HOME=/home/you/.codex
Environment=HARNESS_WHIP_HOME=/home/you/.harness-whip
Restart=on-failure
RestartSec=125

[Install]
WantedBy=default.target
```

Install as a user service only after reviewing the paths and connection mode.
The restart delay allows a crashed watcher's two-minute lease to expire. Do not
run a second service with a different state directory for the same conversations.

## Windows Task Scheduler

The previously verified Windows setup used a per-user task **Codex Whip**,
starting 30 seconds after Windows sign-in and restarting after failure with a
three-minute delay. Its hidden launcher and machine-specific paths live in
`~/.codex-whip/start-watcher.ps1` and `~/.codex-whip/startup.json`.
The rename keeps `bin/codex-whip.mjs` as a compatibility entry point; it does not
rename or reconfigure an existing scheduled task.
It runs desktop mode with `watch --all --interval 5 --json`.

Use `harness-whip status` to check it. Logs for that setup are under `~/.codex-whip/logs/`;
`current-run.json` names the active process and log files. `harness-whip pause`
blocks future sends without removing the task. To disable sign-in startup, use
Task Scheduler or `Disable-ScheduledTask -TaskName 'Codex Whip'` in PowerShell.
This local setup does not install a startup task for other people who clone the repo.

Create a task running as your current user, while logged on for desktop mode.
Use the absolute `node.exe` path as the executable, your absolute
`bin/harness-whip.mjs` path followed by `watch --project <absolute-project-path>`
as arguments, and the checkout as the working directory. Set restart delay to
at least two minutes. Keep the Codex desktop app and target conversation loaded.
The CLI does not register the task or change power settings itself.

## Containers and sandboxes

Install Node 22.18+ and a compatible Codex executable. Authenticate using Codex's
supported mechanism in that environment. Mount the project, Codex home and Whip
state persistently. Run one foreground `watch --connection stdio` process through
your supervisor. No inbound port or browser interface is required.

The sandbox must live long enough to reach reset. Ephemeral compute that is
destroyed at disconnect will not resume itself; use durable supervision and storage.
Avoid copying a running desktop's database directory into a different environment.

## Investigating attention entries

Use `status` and `history` to find the exact thread. Inspect it in Codex. If the
message was accepted, let that work proceed. If it was not, continue manually.
The same failed turn remains blocked from automatic resend; a later distinct
quota-failed turn can qualify.

Run all controls with the same state directory as the watcher.
Do not delete uncertain-dispatch records to force another automatic send.
