![Codex Whip](docs/codex-whip-banner.png)

# Codex Whip

Automatically resume selected Codex conversations when their usage limit resets.
One TypeScript process, SQLite persistence, zero runtime npm dependencies.

## Install

Requires **Node.js 22.18+** and an installed, signed-in Codex runtime. From this checkout:

```sh
npm ci
npm run build
npm link
```

You can now call `codex-whip` from any directory. After changing the source, run
`npm run build` again.

## Use

```sh
codex-whip doctor                  # Check the connection and quota
codex-whip watch --project .       # Watch the current project
codex-whip watch --all             # Watch all local root conversations
codex-whip status                 # Whip counts, pending work and last activity
codex-whip pause                   # Pause future continuations
codex-whip resume                  # Enable them again
```

Use `codex-whip list` to find conversation IDs, then `watch --thread UUID` to
select one conversation, including an existing quota failure. Project/global
scopes watch new failures and leave historical failures alone.

Desktop mode requires Codex and the selected conversation to remain loaded.
For headless sessions in a sandbox, use `--connection stdio`. Keep the watcher
running in either case; `Ctrl+C` stops it.

`--dry-run` observes without sending. `--json` emits structured logs.
See `codex-whip --help` for all options.

## Behavior

Only confirmed quota failures qualify. Whip rechecks capacity and conversation
state before sending, preserves execution settings, and prevents duplicate sends.
Completed work, manual stops, approvals and queued user messages are left alone.
Uncertain delivery needs manual inspection. There is no per-conversation whip cap.

Experimental: Windows desktop recovery after a manual account reset is verified.
Natural overnight reset recovery remains unverified. See [compatibility](docs/verification.md).

## Contribute

Run `npm run check`. Read the [architecture](docs/architecture.md) and
[contribution guide](CONTRIBUTING.md).

[Operations](docs/operations.md) · [Privacy](docs/privacy.md) ·
[Credits](NOTICE.md) · [MIT license](LICENSE)

Independent project, unaffiliated with OpenAI.
