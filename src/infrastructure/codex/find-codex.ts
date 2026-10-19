import { existsSync, readdirSync, statSync } from "node:fs";
import { join, delimiter, resolve } from "node:path";
import { homedir } from "node:os";

export function findCodex(explicit?: string): string {
    if (explicit) {
        const path = resolve(explicit);
        if (!existsSync(path)) {
            throw new Error("The configured Codex executable does not exist");
        }
        return path;
    }
    const desktopRoots =
        process.platform === "win32"
            ? [join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "bin")]
            : [
                  "/Applications/ChatGPT.app/Contents/Resources",
                  "/Applications/Codex.app/Contents/Resources",
              ];
    const candidates: string[] = [];
    for (const root of desktopRoots) {
        if (!existsSync(root)) {
            continue;
        }
        const binary = process.platform === "win32" ? "codex.exe" : "codex";
        if (existsSync(join(root, binary))) {
            candidates.push(join(root, binary));
        }
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (
                entry.isDirectory() &&
                /^[a-f0-9]+$/.test(entry.name) &&
                existsSync(join(root, entry.name, binary))
            ) {
                candidates.push(join(root, entry.name, binary));
            }
        }
    }
    if (candidates.length) {
        return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
    }
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
        const executable = join(directory, process.platform === "win32" ? "codex.exe" : "codex");
        if (existsSync(executable)) {
            return executable;
        }
        // npm's Windows shim requires cmd.exe. Resolve the actual native binary instead.
        const packages = join(directory, "node_modules", "@openai");
        if (process.platform === "win32" && existsSync(packages)) {
            for (const name of readdirSync(packages).filter((entry) => entry.startsWith("codex"))) {
                const vendor = join(packages, name, "vendor");
                if (existsSync(vendor)) {
                    for (const target of readdirSync(vendor)) {
                        const path = join(vendor, target, "codex", "codex.exe");
                        if (existsSync(path)) {
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
