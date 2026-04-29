import type { UIMessage } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { DataStore } from "../../foundation/datastore/types";
import { compactViaAPI } from "./api-compact";
import { estimateMessagesTokens } from "./token-counter";

const compactQueue = new Map<string, Promise<void>>();

/**
 * Run compaction in the background without blocking the response.
 * Prevents duplicate compaction for the same conversation.
 */
export function runCompactInBackground(
  messages: UIMessage[],
  conversationId: string,
  dataStore: DataStore,
  model?: LanguageModelV3
): void {
  if (compactQueue.has(conversationId)) {
    console.log(`[Background Compact] Already in progress for ${conversationId}, skipping`);
    return;
  }

  const promise = (async () => {
    try {
      const tokenCount = await estimateMessagesTokens(messages);
      if (tokenCount < 15_000) {
        console.log(`[Background Compact] Skipping ${conversationId} (${tokenCount} tokens, below threshold)`);
        return;
      }

      console.log(`[Background Compact] Starting for ${conversationId} (${tokenCount} tokens)`);

      const result = await compactViaAPI(messages, conversationId, dataStore, model);

      if (result.executed) {
        console.log(
          `[Background Compact] Completed for ${conversationId}: freed ${result.tokensFreed} tokens`
        );
      }
    } catch (error) {
      console.error(`[Background Compact] Failed for ${conversationId}:`, error);
    } finally {
      compactQueue.delete(conversationId);
    }
  })();

  // Don't await — fire and forget
  promise.catch(() => {});
  compactQueue.set(conversationId, promise);
}

export function isCompactInProgress(conversationId: string): boolean {
  return compactQueue.has(conversationId);
}

export function getQueueSize(): number {
  return compactQueue.size;
}
