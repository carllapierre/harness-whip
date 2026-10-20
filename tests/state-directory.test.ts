import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stateDirectory } from "../src/composition/create-runtime.ts";
import { SqliteRecoveryStore } from "../src/infrastructure/persistence/sqlite-recovery-store.ts";

test("renamed defaults preserve an existing ledger, pause state and lease", () => {
    const previous = {
        current: process.env.HARNESS_WHIP_HOME,
        legacy: process.env.CODEX_WHIP_HOME,
    };
    delete process.env.HARNESS_WHIP_HOME;
    delete process.env.CODEX_WHIP_HOME;
    const home = mkdtempSync(join(tmpdir(), "whip-state-"));
    try {
        assert.equal(stateDirectory(undefined, home), join(home, ".harness-whip"));
        const legacy = join(home, ".codex-whip");
        const store = new SqliteRecoveryStore(join(legacy, "whip.sqlite"));
        store.pause(true);
        assert.equal(store.acquireLease("legacy-watcher", 1000), true);
        store.close();
        assert.equal(stateDirectory(undefined, home), legacy);
        const reopened = new SqliteRecoveryStore(
            join(stateDirectory(undefined, home), "whip.sqlite"),
        );
        assert.equal(reopened.paused(), true);
        assert.equal(reopened.acquireLease("new-watcher", 2000), false);
        reopened.close();
        const current = join(home, ".harness-whip");
        mkdirSync(current);
        new SqliteRecoveryStore(join(current, "whip.sqlite")).close();
        assert.throws(() => stateDirectory(undefined, home), /choose --state-dir explicitly/);
        process.env.CODEX_WHIP_HOME = "legacy-override";
        assert.equal(stateDirectory(undefined, home), resolve("legacy-override"));
        process.env.HARNESS_WHIP_HOME = "current-override";
        assert.equal(stateDirectory(undefined, home), resolve("current-override"));
        assert.equal(stateDirectory("explicit", home), resolve("explicit"));
    } finally {
        for (const [key, value] of [
            ["HARNESS_WHIP_HOME", previous.current],
            ["CODEX_WHIP_HOME", previous.legacy],
        ] as const) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        rmSync(home, { recursive: true, force: true });
    }
});
