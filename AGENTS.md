# Codex Whip

- Follow [architecture](docs/architecture.md) and [verification](docs/verification.md).
- Build one lightweight TypeScript CLI with zero npm runtime dependencies unless
  a concrete need justifies a change. Keep dependencies and abstractions purposeful.
- Keep domain policies pure. Application use cases depend on ports; Codex and SQL
  belong in infrastructure; runtime wiring belongs in composition.
- Use strict TypeScript, four spaces, explicit braces and named recovery states.
- Preserve exact-thread targeting, observed-failure baselines, quota rechecks,
  dispatch claims, pause/exclusion checks and uncertain-delivery protection.
- Never answer Codex approvals/user questions or broaden execution permissions.
- Keep real credentials, conversation payloads and runtime databases out of Git.
- Run focused tests while implementing. Before delivery run `npm run check` and
  inspect `npm pack --dry-run` if packaging changed.
- Document actual compatibility evidence. A synthetic test does not establish a
  successful natural quota-reset cycle or a tested operating system.
- Keep this file short. Product behavior belongs in the README and architecture docs.
