import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { SqliteRecoveryStore } from "../infrastructure/persistence/sqlite-recovery-store.ts";
import {
    NativeCodexConnection,
    type ConnectionMode,
} from "../infrastructure/codex/codex-connection.ts";
import { codexHome, findCodex } from "../infrastructure/codex/find-codex.ts";
import { EventLogger } from "../presentation/cli/event-logger.ts";

export interface RuntimeOptions {
    stateDir?: string;
    codex?: string;
    codexHome?: string;
    connection: ConnectionMode;
    socket?: string;
    json: boolean;
    noColor: boolean;
}

export function stateDirectory(explicit?: string, home = homedir()): string {
    const configured = explicit ?? process.env.HARNESS_WHIP_HOME ?? process.env.CODEX_WHIP_HOME;
    if (configured) {
        return resolve(configured);
    }
    const current = join(home, ".harness-whip");
    const legacy = join(home, ".codex-whip");
    if (existsSync(join(legacy, "whip.sqlite"))) {
        if (existsSync(join(current, "whip.sqlite"))) {
            throw new Error(
                "Both Harness Whip and legacy Codex Whip state exist; choose --state-dir explicitly",
            );
        }
        // Reuse the ledger, pause controls and lease rather than creating a second watcher.
        return legacy;
    }
    return current;
}

export function projectPath(path: string): string {
    const absolute = resolve(path);
    let canonical: string;
    try {
        canonical = realpathSync.native(absolute);
    } catch {
        canonical = absolute;
    }
    return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

export function matchesProject(project: string, selected: string): boolean {
    const child = projectPath(project);
    const parent = projectPath(selected);
    const difference = relative(parent, child);
    return (
        difference === "" ||
        (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
    );
}

export function openStore(directory?: string): SqliteRecoveryStore {
    return new SqliteRecoveryStore(join(stateDirectory(directory), "whip.sqlite"));
}

export function createRuntime(options: RuntimeOptions) {
    const codex = new NativeCodexConnection(
        findCodex(options.codex),
        codexHome(options.codexHome),
        options.connection,
        options.socket,
    );
    return {
        codex,
        store: openStore(options.stateDir),
        clock: { now: () => Date.now() },
        events: new EventLogger(options.json, options.noColor ? false : undefined),
    };
}
