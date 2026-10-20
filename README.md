![Harness Whip](docs/harness-whip-banner.png)

# Harness Whip

Pick up where your agent left off. A lightweight CLI that resumes selected
conversations when their usage limit resets. One TypeScript process, SQLite
persistence, zero runtime npm dependencies.

**Currently supports Codex only.** Support for more agent subscriptions is planned.

## Install

Requires **Node.js 22.18+** and an installed, signed-in Codex runtime. From this checkout:

```sh
npm ci
npm run build
npm link
```

You can now call `harness-whip` from any directory. After changing the source, run
`npm run build` again. The legacy `codex-whip` command remains an alias.

On macOS, check `node --version` first. If you use nvm, run `nvm install` and
`nvm use` in this checkout; `.nvmrc` selects Node 22. The CLI discovers Codex in
system or user Applications folders, including the runtime bundled with ChatGPT,
and falls back to PATH. Use `--codex /absolute/path/to/codex` for a custom installation.

## Use

```sh
harness-whip doctor                  # Check the connection and quota
harness-whip watch --project .       # Watch the current project
harness-whip watch --all             # Watch all local root conversations
harness-whip status                  # Whip counts, pending work and last activity
harness-whip pause                   # Pause future continuations
harness-whip resume                  # Enable them again
```

Use `harness-whip list` to find conversation IDs, then `watch --thread UUID` to
select one conversation, including an existing quota failure. Project/global
scopes watch new failures and leave historical failures alone.

Desktop mode requires Codex and the selected conversation to remain loaded.
Start with `harness-whip doctor --thread UUID` and
`harness-whip watch --project . --dry-run --once` to check your setup.
For headless sessions in a sandbox, use `--connection stdio`. Keep the watcher
running in either case; `Ctrl+C` stops it.

`--dry-run` observes without sending. `--json` emits structured logs.
See `harness-whip --help` for all options. New installations store state in
`~/.harness-whip`; existing `~/.codex-whip` databases are reused automatically.
See [upgrade and process guidance](docs/operations.md) for state overrides and startup.

## Behavior and compatibility

Only confirmed quota failures qualify. Whip rechecks capacity and conversation
state before sending, preserves execution settings, and prevents duplicate sends.
Completed work, manual stops, approvals and queued user messages are left alone.
Uncertain delivery needs manual inspection. There is no per-conversation whip cap.

Experimental: Windows desktop recovery after a manual account reset is verified.
macOS compatibility checks and their limits are recorded in
[verification](docs/verification.md). Natural scheduled-reset recovery remains
unverified. Whip must stay running and the machine must stay awake to observe a reset.

## Contribute

Run `npm run check`. Read the [architecture](docs/architecture.md) and
[contribution guide](CONTRIBUTING.md).

[Operations](docs/operations.md) · [Privacy](docs/privacy.md) ·
[Credits](NOTICE.md) · [MIT license](LICENSE)

Independent project, unaffiliated with OpenAI.
