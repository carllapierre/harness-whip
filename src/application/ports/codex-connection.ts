import type {
    Conversation,
    QuotaSnapshot,
    ThreadSnapshot,
    TurnObservation,
} from "../../domain/recovery/recovery-model.ts";

export interface CodexConnection {
    listConversations(): Promise<Conversation[]>;
    observe(thread: Conversation): Promise<TurnObservation>;
    inspect(threadId: string): Promise<ThreadSnapshot>;
    quota(bucket?: string): Promise<QuotaSnapshot>;
    continue(threadId: string, message: string, expected: ThreadSnapshot): Promise<string>;
    close(): Promise<void>;
}
