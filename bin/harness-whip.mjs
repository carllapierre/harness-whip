#!/usr/bin/env node
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
    process.stderr.write(
        `Harness Whip requires Node.js 22.18+ (running ${process.versions.node}). Switch Node versions and retry.\n`,
    );
    process.exit(1);
}

// Suppress only Node 22's known SQLite warning; application errors remain visible.
const originalEmit = process.emit;
process.emit = function (event, ...args) {
    const warning = args[0];
    if (
        event === "warning" &&
        warning?.name === "ExperimentalWarning" &&
        warning.message.startsWith("SQLite is an experimental feature")
    ) {
        return false;
    }
    return Reflect.apply(originalEmit, this, [event, ...args]);
};
try {
    await import("../dist/presentation/cli/main.js");
} catch (error) {
    if (
        error.code === "ERR_MODULE_NOT_FOUND" &&
        error.message.includes("dist/presentation/cli/main.js")
    ) {
        process.stderr.write("Harness Whip is not built. Run npm ci && npm run build.\n");
        process.exitCode = 1;
    } else {
        throw error;
    }
}
