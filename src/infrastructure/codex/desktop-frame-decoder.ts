// Snapshot history can exceed 32 MiB in long-running chats. Keep a bounded
// frame, collecting chunks without copying the accumulated body on every read.
export const MAX_DESKTOP_FRAME_BYTES = 128 * 1024 * 1024;

export class DesktopFrameDecoder {
    private header = Buffer.alloc(4);
    private headerBytes = 0;
    private size = 0;
    private received = 0;
    private parts: Buffer[] = [];

    constructor(private maximum = MAX_DESKTOP_FRAME_BYTES) {}

    receive(chunk: Buffer, frame: (data: string) => void): void {
        let offset = 0;
        while (offset < chunk.length) {
            if (this.headerBytes < 4) {
                const count = Math.min(4 - this.headerBytes, chunk.length - offset);
                chunk.copy(this.header, this.headerBytes, offset, offset + count);
                this.headerBytes += count;
                offset += count;
                if (this.headerBytes < 4) {
                    return;
                }
                this.size = this.header.readUInt32LE(0);
                if (this.size === 0 || this.size > this.maximum) {
                    throw new Error(
                        `Desktop frame size ${this.size} bytes is outside the supported range 1–${this.maximum} bytes`,
                    );
                }
            }
            const count = Math.min(this.size - this.received, chunk.length - offset);
            if (count > 0) {
                this.parts.push(chunk.subarray(offset, offset + count));
                this.received += count;
                offset += count;
            }
            if (this.received === this.size) {
                const body =
                    this.parts.length === 1 ? this.parts[0]! : Buffer.concat(this.parts, this.size);
                this.headerBytes = 0;
                this.received = 0;
                this.parts = [];
                frame(body.toString("utf8"));
            }
        }
    }
}
