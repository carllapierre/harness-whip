import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { join, delimiter, resolve } from "node:path";
import { homedir } from "node:os";

function executable(path: string): boolean {
    try {
        accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

function desktopResources(): string[] {
    if (process.platform === "win32") {
        return process.env.LOCALAPPDATA
            ? [join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin")]
            : [];
    }
    if (process.platform === "darwin") {
        return ["/Applications", join(homedir(), "Applications")].flatMap((directory) =>
            ["ChatGPT.app", "Codex.app"].map((app) =>
                join(directory, app, "Contents", "Resources"),
            ),
        );
    }
    return [];
}

export function findCodex(explicit?: string, desktopRoots = desktopResources()): string {
    if (explicit) {
        const path = resolve(explicit);
        if (!executable(path)) {
            throw new Error("The configured Codex executable is missing or not executable");
        }
        return path;
    }
    const candidates: string[] = [];
    for (const root of desktopRoots) {
        if (!existsSync(root)) {
            continue;
        }
        const binary = process.platform === "win32" ? "codex.exe" : "codex";
        const paths = [
            join(root, binary),
            join(root, "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
            join(root, "codex-cli", "bin", "codex"),
        ];
        candidates.push(...paths.filter(executable));
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            const path = join(root, entry.name, binary);
            if (entry.isDirectory() && /^[a-f0-9]+$/.test(entry.name) && executable(path)) {
                candidates.push(path);
            }
        }
    }
    if (candidates.length) {
        return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
    }
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
        if (!directory) {
            continue;
        }
        const path = join(directory, process.platform === "win32" ? "codex.exe" : "codex");
        if (executable(path)) {
            return path;
        }
        // npm's Windows shim requires cmd.exe. Resolve the actual native binary instead.
        const packages = join(directory, "node_modules", "@openai");
        if (process.platform === "win32" && existsSync(packages)) {
            for (const name of readdirSync(packages).filter((entry) => entry.startsWith("codex"))) {
                const vendor = join(packages, name, "vendor");
                if (existsSync(vendor)) {
                    for (const target of readdirSync(vendor)) {
                        const path = join(vendor, target, "codex", "codex.exe");
                        if (executable(path)) {
                            return path;
                        }
                    }
                }
            }
        }
    }
    throw new Error(
        "Codex executable not found. Install Codex or pass --codex /absolute/path/to/codex",
    );
}

export function codexHome(explicit?: string): string {
    return resolve(explicit ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
}
