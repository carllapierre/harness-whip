import test from "node:test";
import assert from "node:assert/strict";
import { parseArguments } from "../src/presentation/cli/arguments.ts";
import { clean } from "../src/presentation/cli/event-logger.ts";
import { matchesProject } from "../src/composition/create-runtime.ts";

test("CLI validates options and accepts repeatable project scopes", () => {
    const args = parseArguments([
        "watch",
        "--project",
        "one",
        "--project",
        "two",
        "--dry-run",
        "--json",
    ]);
    assert.equal(args.scope.projects.length, 2);
    assert.equal(args.dryRun, true);
    assert.throws(() => parseArguments(["watch", "--interval", "0"]));
    assert.throws(() => parseArguments(["watch", "--connection", "magic"]));
    assert.throws(() => parseArguments(["watch", "--typo"]));
});

test("project scoping respects directory boundaries", () => {
    assert.equal(matchesProject("/projects/app/src", "/projects/app"), true);
    assert.equal(matchesProject("/projects/app-other", "/projects/app"), false);
    assert.equal(matchesProject("/projects/app/..notes", "/projects/app"), true);
});

test("terminal output removes control sequences and injected newlines", () => {
    assert.equal(clean("\u001b[31mred\u001b[0m\nFAKE EVENT\u0007"), "red FAKE EVENT ");
});
