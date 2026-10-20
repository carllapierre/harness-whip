import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findCodex } from "../src/infrastructure/codex/find-codex.ts";

test("discovery finds the native executable inside a macOS desktop bundle", () => {
    const directory = mkdtempSync(join(tmpdir(), "whip-discovery-"));
    try {
        const resources = join(directory, "ChatGPT.app", "Contents", "Resources");
        const binary = join(resources, "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex");
        mkdirSync(dirname(binary), { recursive: true });
        writeFileSync(binary, "synthetic executable", { mode: 0o755 });
        assert.equal(findCodex(undefined, [resources]), binary);
        assert.equal(findCodex(binary), binary);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("an explicitly configured directory or non-executable file is rejected", () => {
    const directory = mkdtempSync(join(tmpdir(), "whip-discovery-"));
    try {
        assert.throws(() => findCodex(directory), /not executable/);
        assert.throws(() => findCodex(join(directory, "missing")), /not executable/);
        if (process.platform !== "win32") {
            const path = join(directory, "codex");
            writeFileSync(path, "not executable");
            chmodSync(path, 0o644);
            assert.throws(() => findCodex(path), /not executable/);
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
