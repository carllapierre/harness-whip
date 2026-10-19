import { spawnSync } from "node:child_process";
import { cpSync, readdirSync } from "node:fs";

const compile = spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json"],
    { stdio: "inherit" },
);
if (compile.status !== 0) {
    process.exit(compile.status ?? 1);
}
cpSync("migrations", ".cache/test-build/migrations", { recursive: true });
const files = readdirSync(".cache/test-build/tests")
    .filter((file) => file.endsWith(".test.js"))
    .map((file) => `.cache/test-build/tests/${file}`);
const test = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(test.status ?? 1);
