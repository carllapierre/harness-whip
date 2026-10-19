import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
    const message = JSON.parse(line);
    if (message.method === "initialize") {
        process.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
    } else if (message.method === "test/echo") {
        process.stdout.write(`${JSON.stringify({ id: message.id, result: message.params })}\n`);
    } else if (message.method === "test/error") {
        process.stdout.write(
            `${JSON.stringify({ id: message.id, error: { code: -32601, message: "private remote details" } })}\n`,
        );
    } else if (message.method === "test/disconnect") {
        process.exit(0);
    } else if (message.method === "test/approval") {
        process.stdout.write(
            `${JSON.stringify({ id: 999, method: "item/commandExecution/requestApproval", params: { threadId: "example" } })}\n`,
        );
        process.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
    } else if (message.id === 999) {
        if (!message.error || message.result) {
            process.exit(5);
        }
    }
}
