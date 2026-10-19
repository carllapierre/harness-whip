import { openStore, stateDirectory } from "../../../composition/create-runtime.ts";
import type { parseArguments } from "../arguments.ts";
import { EventLogger } from "../event-logger.ts";
import { showStatus } from "./show-status.ts";

export function localControls(options: ReturnType<typeof parseArguments>): boolean {
    if (!["status", "history", "pause", "resume", "cancel", "include"].includes(options.command)) {
        return false;
    }
    const store = openStore(options.stateDir);
    const logger = new EventLogger(options.json, options.noColor ? false : undefined);
    try {
        if (options.command === "status") {
            showStatus(store, stateDirectory(options.stateDir), options.json);
        } else if (options.command === "history") {
            const events = store.history(options.limit);
            if (!events.length && !options.json) {
                process.stdout.write("No activity recorded.\n");
            }
            for (const event of events.reverse()) {
                logger.write(event);
            }
        } else {
            if (options.command === "pause" || options.command === "resume") {
                store.pause(options.command === "pause");
            } else {
                if (options.scope.threads.length !== 1) {
                    throw new Error("This command requires exactly one --thread UUID");
                }
                store.exclude(options.scope.threads[0]!, options.command === "cancel");
            }
            const messages: Record<string, string> = {
                pause: "Future continuations paused; running work is unchanged",
                resume: "Future continuations enabled",
                cancel: "Conversation excluded; accepted messages cannot be retracted",
                include: "Conversation exclusion removed",
            };
            const event = {
                at: Date.now(),
                kind: options.command,
                message: messages[options.command]!,
                threadId: options.scope.threads[0],
            };
            store.record(event);
            logger.write(event);
        }
    } finally {
        store.close();
    }
    return true;
}
