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

/**
 * 等待指定对话的后台压缩完成
 *
 * 如果没有进行中的压缩，立即 resolve。
 * 压缩失败不影响等待流程（错误被吞掉）。
 *
 * @param conversationId - 对话 ID
 * @returns Promise，等待完成后 resolve
 *
 * @example
 * // 在 AgentHandle.dispose 中调用
 * await waitForConversationCompaction(conversationId);
 */
export async function waitForConversationCompaction(conversationId: string): Promise<void> {
  const promise = compactQueue.get(conversationId);
  if (promise) {
    await promise.catch(() => {}); // 压缩失败不影响等待流程
  }
}

/**
 * 等待所有正在进行的后台压缩完成
 *
 * 用于优雅退出场景：关闭数据库前确保所有摘要写入完成。
 *
 * @returns Promise，所有压缩完成后 resolve
 *
 * @example
 * // 在 CoreRuntime.dispose 中调用
 * await waitForAllCompactions();
 * dataStore.close();
 */
export async function waitForAllCompactions(): Promise<void> {
  if (compactQueue.size === 0) return;
  const promises = Array.from(compactQueue.values());
  await Promise.allSettled(promises);
}

/**
 * 获取正在压缩的对话列表
 *
 * @returns 正在压缩的 conversationId 数组
 */
export function getActiveCompactionIds(): string[] {
  return Array.from(compactQueue.keys());
}
