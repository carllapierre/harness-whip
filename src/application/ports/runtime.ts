import type { Activity } from "../../domain/recovery/recovery-model.ts";

export interface Clock {
    now(): number;
}

export interface EventSink {
    write(event: Activity): void;
}
