# Contributing

Use Node.js 22.18+ and npm. Run `npm ci`, then `npm run check`. Keep the lockfile
committed. Tests use synthetic data and local temporary SQLite databases.

Read [architecture](docs/architecture.md) before changing boundaries. Use strict
TypeScript, four spaces, explicit braces, named states and descriptive filenames.
Keep domain policies free of I/O and use an injected clock for recovery tests.
Wire real adapters in composition; prefer ordinary functions to speculative layers.

Production currently has zero npm runtime dependencies. A new dependency needs a
clear purpose and should remove more complexity than it adds. Do not replace
behavior tests with tests that merely repeat an implementation.

Pull requests should explain the behavior changed, relevant validation and material
limitations. Conventional Commit titles (`feat:`, `fix:`, `docs:`) are welcome.
Ticket IDs are optional. Keep unrelated formatting and generated files out of PRs.

Never weaken exact-thread targeting, structured quota evidence, durable dispatch
intent or uncertain-delivery protection. Include regression tests for changes to
those behaviors. Record compatibility checks as tested, simulated or unverified.

Do not submit private conversation dumps, credentials, your Codex databases or
logs containing sensitive paths. Synthetic fixtures are sufficient for most bugs.
