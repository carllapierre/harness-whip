import { parseArguments, HELP } from "./arguments.ts";
import { clean } from "./event-logger.ts";
import { createRuntime, matchesProject } from "../../composition/create-runtime.ts";
import { localControls } from "./commands/local-controls.ts";
import { runWatcher } from "./commands/run-watcher.ts";

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    if (options.version) {
        process.stdout.write("0.1.0\n");
        return;
    }
    if (options.help || options.command === "help") {
        process.stdout.write(HELP);
        return;
    }
    if (localControls(options)) {
        return;
    }
    if (!["watch", "list", "doctor"].includes(options.command)) {
        throw new Error(`Unknown command: ${options.command}`);
    }
    if (
        options.command === "watch" &&
        !options.scope.all &&
        !options.scope.projects.length &&
        !options.scope.threads.length
    ) {
        throw new Error("Choose --project PATH, --thread UUID, or --all");
    }
    const runtime = createRuntime(options);
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
        if (options.command === "doctor") {
            const result = await runtime.codex.diagnostics(options.bucket);
            if (options.scope.threads[0]) {
                result.snapshot = await runtime.codex.inspect(options.scope.threads[0]);
            }
            process.stdout.write(`${JSON.stringify(result, null, options.json ? undefined : 2)}\n`);
        } else if (options.command === "list") {
            for (const thread of await runtime.codex.listConversations()) {
                if (
                    options.scope.projects.length &&
                    !options.scope.projects.some((project) =>
                        matchesProject(thread.project, project),
                    )
                ) {
                    continue;
                }
                process.stdout.write(
                    options.json
                        ? `${JSON.stringify(thread)}\n`
                        : `${thread.id}  ${clean(thread.title)}\n  ${clean(thread.project)}\n`,
                );
            }
        } else {
            await runWatcher(runtime, options, controller);
        }
    } finally {
        await runtime.codex.close();
        runtime.store.close();
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? clean(error.message) : "Unexpected error";
    process.stderr.write(
        process.argv.includes("--json")
            ? `${JSON.stringify({ kind: "error", message })}\n`
            : `Harness Whip: ${message}\n`,
    );
    process.exitCode = 1;
});
