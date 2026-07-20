// ============================================================
// Compaction Checkpoint - 从 checkpoint 之后加载历史
// ============================================================
// 加载会话历史时,如果存在 compaction checkpoint(已存摘要 + 锚点消息 id),
// 直接返回 [摘要消息, ...锚点之后的消息],而非全量历史。这样:
//   - 发给 API 的前缀稳定 → 改善 prompt cache 命中
//   - 无需每次请求重跑 LLM 摘要
//
// 安全前提:DB 始终保存全量历史(压缩只在内存中对模型请求生效)。
// 因此本函数纯属叠加优化——锚点找不到 / 无摘要 / 任何异常,一律回退全量历史,
// 绝不丢失消息。见 docs/context-compaction-analysis.md E。

import type { UIMessage } from 'ai';
import type { DataStore } from '../../primitives/datastore/types';
import { logger } from '../../primitives/logger';

/** checkpoint 摘要消息的 id 前缀,用于识别/去重 */
export const CHECKPOINT_SUMMARY_ID_PREFIX = 'checkpoint-summary-';

/**
 * 构建 checkpoint 摘要消息。
 * 注意:这里必须是 UIMessage 的 .parts 格式——本函数在 route 层(UIMessage 流水线)使用,
 * 消息随后要过 validateUIMessages/convertToModelMessages;.content 格式会导致校验抛错、
 * 以及 route 层 `for (const part of msg.parts)` 崩溃。
 * (enforceContextWindow 内部的 .content 摘要属于 ModelMessage 流水线,是另一层,勿混淆。)
 */
function buildCheckpointSummaryMessage(summary: string): UIMessage {
  return {
    id: `${CHECKPOINT_SUMMARY_ID_PREFIX}${Date.now()}`,
    role: 'user',
    parts: [{
      type: 'text',
      text: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n${summary}`,
    }],
  } as UIMessage;
}

/**
 * 应用 compaction checkpoint:若有可用 checkpoint,返回压缩后的历史;否则原样返回。
 *
 * @param fullMessages 全量历史消息(来自 DB)
 * @param conversationId 会话 id
 * @param dataStore 数据存储
 * @returns 压缩后的消息列表(或全量,若无可用 checkpoint)
 */
export function applyCheckpointOnLoad(
  fullMessages: UIMessage[],
  conversationId: string,
  dataStore: DataStore,
): UIMessage[] {
  try {
    const stored = dataStore.summaryStore.getSummaryByConversation(conversationId);
    if (!stored || !stored.summary || !stored.anchorMessageId) {
      return fullMessages; // 无摘要或无锚点 → 全量
    }

    const anchorIndex = fullMessages.findIndex(
      (m) => (m as unknown as { id?: string }).id === stored.anchorMessageId,
    );
    // 锚点找不到(消息被删/id 变更),或锚点已是最后一条(无可保留的后段)→ 全量
    if (anchorIndex < 0) {
      logger.debug('Checkpoint', `anchor ${stored.anchorMessageId} not found, loading full history`);
      return fullMessages;
    }

    const newerMessages = fullMessages.slice(anchorIndex + 1);
    // 锚点之后没有新消息 → 没必要压缩,返回全量(避免只发一条摘要)
    if (newerMessages.length === 0) {
      return fullMessages;
    }

    const summaryMessage = buildCheckpointSummaryMessage(stored.summary);
    return [summaryMessage, ...newerMessages];
  } catch (err) {
    // 任何异常 → 回退全量,绝不丢历史
    logger.warn('Checkpoint', 'applyCheckpointOnLoad failed, loading full history:', err);
    return fullMessages;
  }
}
