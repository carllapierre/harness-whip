import type {
    Conversation,
    QuotaSnapshot,
    ThreadSnapshot,
} from "../../domain/recovery/recovery-model.ts";

export interface CodexConnection {
    listConversations(): Promise<Conversation[]>;
    inspect(threadId: string): Promise<ThreadSnapshot>;
    quota(bucket?: string): Promise<QuotaSnapshot>;
    continue(threadId: string, message: string, expected: ThreadSnapshot): Promise<string>;
    close(): Promise<void>;
}
