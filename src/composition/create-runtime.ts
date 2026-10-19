import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
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

export function stateDirectory(explicit?: string): string {
    return resolve(explicit ?? process.env.CODEX_WHIP_HOME ?? join(homedir(), ".codex-whip"));
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
