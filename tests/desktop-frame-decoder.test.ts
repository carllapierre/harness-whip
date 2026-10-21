import test from "node:test";
import assert from "node:assert/strict";
import {
    DesktopFrameDecoder,
    MAX_DESKTOP_FRAME_BYTES,
} from "../src/infrastructure/codex/desktop-frame-decoder.ts";

function framed(value: string): Buffer {
    const body = Buffer.from(value);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    return Buffer.concat([header, body]);
}

test("desktop frame boundaries survive fragmented headers, Unicode and coalesced messages", () => {
    const decoder = new DesktopFrameDecoder();
    const frames: string[] = [];
    const input = Buffer.concat([framed("Équipement 🧰"), framed("next message")]);
    for (const byte of input.subarray(0, 12)) {
        decoder.receive(Buffer.from([byte]), (value) => frames.push(value));
    }
    decoder.receive(input.subarray(12), (value) => frames.push(value));
    assert.deepEqual(frames, ["Équipement 🧰", "next message"]);
});

test("invalid or excessive declared frame sizes fail before reading a body", () => {
    for (const size of [0, MAX_DESKTOP_FRAME_BYTES + 1, 0xffffffff]) {
        const header = Buffer.alloc(4);
        header.writeUInt32LE(size);
        assert.throws(
            () =>
                new DesktopFrameDecoder().receive(header, () =>
                    assert.fail("No body should be decoded"),
                ),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes(`${size} bytes`));
                return true;
            },
        );
    }
});
