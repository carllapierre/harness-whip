# Sources and acknowledgements

Harness Whip is an independent implementation. Its design was informed by:

- [progressrdx/codex-auto-resume](https://github.com/progressrdx/codex-auto-resume)
  (MIT): exact-thread selection, conservative recovery, quota-window checks and
  desktop IPC snapshot framing/discovery. Its Python implementation was read as
  a protocol reference; this repository implements its own TypeScript transport.
- [songyb111-gachon/codex-auto-resume-windows](https://github.com/songyb111-gachon/codex-auto-resume-windows)
  (MIT): official queue delivery, distinguishing acceptance from continuation,
  and keeping uncertain delivery terminal.
- [OpenAI app-server documentation](https://learn.chatgpt.com/docs/app-server)
  and [CLI reference](https://learn.chatgpt.com/docs/cli/reference): official
  discovery, thread, turn and rate-limit interfaces. Local generated protocol
  bindings were inspected during development and are not distributed here.
- Architectural conventions from Carl Lapierre's PartyKit project: explicit
  domain/application/provider boundaries, composition wiring, strict TypeScript,
  formatting and focused behavior tests.

The banner is a generated raster illustration, made with OpenAI's built-in image
generation tool. Its brief and export dimensions are documented in
[docs/banner.md](docs/banner.md). Codex and OpenAI names identify the integration;
this project is not affiliated with or endorsed by OpenAI.
