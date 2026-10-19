import { parseArgs } from "node:util";
import { resolve } from "node:path";
import type { ConnectionMode } from "../../infrastructure/codex/codex-connection.ts";
import { uuid } from "../../infrastructure/codex/protocol-values.ts";

export const HELP = `
Codex Whip 0.1.0 — Pick up where Codex left off.

Usage: codex-whip <command> [options]

Commands:
  watch       Watch selected conversations and recover quota failures
  list        List available conversations (read-only)
  doctor      Check the Codex runtime, connection and quota (read-only)
  status      Show watcher state, pending recoveries and whip metrics
  history     Show recent recovery events
  pause       Persistently pause automatic continuations
  resume      Allow automatic continuations again
  cancel      Cancel and exclude a conversation (--thread UUID)
  include     Remove a conversation exclusion (--thread UUID)

Selection (watch requires at least one):
  --project PATH     Watch this directory and descendants; repeatable
  --thread UUID      Select an exact conversation; repeatable
  --all              Watch all eligible local root conversations
  --exclude UUID     Exclude a conversation; repeatable

Connection:
  --connection MODE  desktop (default), proxy (shared server), stdio (headless)
  --codex PATH       Absolute native Codex executable (auto-detected otherwise)
  --codex-home PATH  Codex data directory (defaults to CODEX_HOME or ~/.codex)
  --socket PATH      Override desktop IPC endpoint or proxy control socket
  --limit-id ID      Explicit account usage bucket

Operation:
  --dry-run          Observe and schedule; never submit a continuation
  --once             Run one watch cycle and exit
  --interval SEC     Check interval, 5–3600 (default 30)
  --max-whips N      Lifetime automatic attempts per conversation (default 3)
  --state-dir PATH   State directory (or CODEX_WHIP_HOME; default ~/.codex-whip)
  --limit N          Number of history events (default 30)
  --json             Newline-delimited JSON output
  --no-color        Disable ANSI colors (also honors NO_COLOR)
  --help, -h         Show help
  --version, -v      Show version

Broad scopes baseline existing failures. --thread may enroll an existing quota
failure. Restart with the same scope to keep its pending recoveries active.
Closing a terminal stops the process. Use a supervisor for unattended operation.
`;

export function parseArguments(args: string[]) {
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        strict: true,
        options: {
            help: { type: "boolean", short: "h" },
            version: { type: "boolean", short: "v" },
            project: { type: "string", multiple: true },
            thread: { type: "string", multiple: true },
            exclude: { type: "string", multiple: true },
            all: { type: "boolean" },
            connection: { type: "string", default: "desktop" },
            codex: { type: "string" },
            "codex-home": { type: "string" },
            socket: { type: "string" },
            "limit-id": { type: "string" },
            "dry-run": { type: "boolean" },
            once: { type: "boolean" },
            interval: { type: "string", default: "30" },
            "max-whips": { type: "string", default: "3" },
            "state-dir": { type: "string" },
            limit: { type: "string", default: "30" },
            json: { type: "boolean" },
            "no-color": { type: "boolean" },
        },
    });
    if (positionals.length > 1) {
        throw new Error("Unexpected positional arguments");
    }
    const mode = values.connection;
    if (!["desktop", "proxy", "stdio"].includes(mode)) {
        throw new Error("--connection must be desktop, proxy, or stdio");
    }
    const number = (value: string, name: string, minimum: number, maximum: number): number => {
        const result = Number(value);
        if (!Number.isInteger(result) || result < minimum || result > maximum) {
            throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
        }
        return result;
    };
    return {
        command: positionals[0] ?? "help",
        help: values.help ?? false,
        version: values.version ?? false,
        scope: {
            all: values.all ?? false,
            projects: (values.project ?? []).map((path) => resolve(path)),
            threads: (values.thread ?? []).map(uuid),
            excludedThreads: (values.exclude ?? []).map(uuid),
        },
        connection: mode as ConnectionMode,
        codex: values.codex,
        codexHome: values["codex-home"],
        socket: values.socket,
        bucket: values["limit-id"],
        dryRun: values["dry-run"] ?? false,
        once: values.once ?? false,
        intervalMs: number(values.interval, "--interval", 5, 3600) * 1000,
        maxWhips: number(values["max-whips"], "--max-whips", 1, 1000),
        limit: number(values.limit, "--limit", 1, 1000),
        stateDir: values["state-dir"],
        json: values.json ?? false,
        noColor: values["no-color"] ?? false,
    };
}
