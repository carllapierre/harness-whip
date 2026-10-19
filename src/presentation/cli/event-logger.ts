import { stripVTControlCharacters, styleText } from "node:util";
import type { Activity } from "../../domain/recovery/recovery-model.ts";
import type { EventSink } from "../../application/ports/runtime.ts";

export function clean(value: string): string {
    return Array.from(stripVTControlCharacters(value))
        .map((character) => {
            const code = character.codePointAt(0)!;
            return code < 32 || (code >= 127 && code <= 159) ? " " : character;
        })
        .join("");
}

export class EventLogger implements EventSink {
    constructor(
        private json: boolean,
        private color = !!process.stdout.isTTY && !process.env.NO_COLOR,
    ) {}

    write(event: Activity): void {
        if (this.json) {
            process.stdout.write(`${JSON.stringify(event)}\n`);
            return;
        }
        const timestamp = new Date(event.at).toLocaleTimeString([], { hour12: false });
        const colors = {
            whip: "green",
            attention: "yellow",
            wait: "cyan",
            cancel: "gray",
            send: "magenta",
            "dry-run": "blue",
        } as const;
        const label = event.kind.toUpperCase().padEnd(9);
        const color = colors[event.kind as keyof typeof colors];
        const rendered = this.color && color ? styleText(color, label) : label;
        const thread = event.threadId ? ` ${event.threadId.slice(0, 8)}` : "";
        process.stdout.write(`${timestamp}  ${rendered}${thread}  ${clean(event.message)}\n`);
    }
}
