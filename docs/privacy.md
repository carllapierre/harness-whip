# Local data and access

Whip does not operate an HTTP server, send telemetry, read Codex authentication
files or make direct inference requests. The installed Codex executable handles
authentication and its own ordinary service requests.

The local SQLite ledger stores thread/turn UUIDs, titles, project paths, execution
fingerprint hashes, recovery states, timestamps, confirmation IDs and short event
messages. Full conversation text, source code, raw protocol payloads and account
tokens are not stored. Live snapshots and user-message content are inspected in
memory to evaluate eligibility and correlate a continuation.

Human and JSON logs include identifiers and may include project metadata. Treat
the state directory and redirected logs as private. They are excluded from Git.
New state directories use owner-only permissions where supported; Windows relies
on the current user's home-directory ACL. Existing parent-directory permissions
are not rewritten.

Whip is an automation tool running as your OS user. It can ask Codex to continue
work with that conversation's existing permissions. Scope it to work you intend
to resume, and keep its state directory private. `pause` affects future dispatch;
it cannot undo actions already taken by Codex.
