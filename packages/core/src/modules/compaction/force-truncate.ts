// ============================================================
// Force Truncate - 强制截断保底
// ============================================================
// 当所有压缩策略都失败时的最后兜底方案。
// 不调用 LLM，保留首尾消息 + provenance 段，
// 保证永不 413。
//
// 被 lifecycle.ts 的 applyEmergencyCompression 和 budget-check.ts 调用。

import { buildSummaryMessage } from './message-view';
import { estimateMessagesTokens } from './token-counter';
import { appendActionLogProvenance } from './action-log';
import { logger } from '../../primitives/logger';

/**
 * 强制截断：最后的保底方案
 * 当所有压缩策略都失败时，强制保留首尾消息
 *
 * @param messages 消息列表
 * @param keepRatio 保留的比例（默认 0.15，即保留首尾各 15%）
 * @param modelName 模型名称（用于 token 估算）
 * @param maxTokens 最大 token 数（如果提供，会确保结果不超过此值）
 * @returns 截断后的消息
 */
/** 强制截断收敛：每次将保留尾部消息数减少 30%（保留 70%），逼近预算线 */
const FORCE_TRUNCATE_RETAIN_RATIO = 0.7;

export async function forceTruncateMessages(
  messages: import('ai').ModelMessage[],
  keepRatio: number = 0.15,
  modelName?: string,
  maxTokens?: number,
  /** provenance 来源:优先用原始消息(调用方传入),否则用 messages(已是压缩后,可能丢 key) */
  provenanceFrom?: import('ai').ModelMessage[],
): Promise<import('ai').ModelMessage[]> {
  if (messages.length === 0) return [];

  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) {
    // 没有 user 消息，只保留最后几条
    return messages.slice(-5);
  }

  let keepTail = Math.max(5, Math.floor(messages.length * keepRatio));
  let recentMessages = messages.slice(-keepTail);

  // 兜底也要保 provenance:被截断的中间消息里的工具调用(URL/path)用行动日志段保留,
  // 让模型至少知道"这些文件读过、怎么找回",不至于完全失忆。
  // 用 provenanceFrom(原始消息)而非 messages(可能已被上游压缩丢了 tool-call)。
  const warningText = '[警告：由于对话过长，中间部分已省略。建议开始新会话以获得更好的上下文连贯性。]';
  const fullWarningText = appendActionLogProvenance(warningText, provenanceFrom ?? messages);
  const warningMessage = buildSummaryMessage(fullWarningText, 'ui') as import('ai').ModelMessage;

  let result = [firstUserMsg, warningMessage, ...recentMessages];

  // 如果提供了 maxTokens，确保结果不超过限制
  if (modelName && maxTokens) {
    let currentTokens = await estimateMessagesTokens(result, modelName);

    // 逐步减少尾部消息直到满足限制
    while (currentTokens > maxTokens && keepTail > 1) {
      keepTail = Math.max(1, Math.floor(keepTail * FORCE_TRUNCATE_RETAIN_RATIO));
      recentMessages = messages.slice(-keepTail);
      result = [firstUserMsg, warningMessage, ...recentMessages];
      currentTokens = await estimateMessagesTokens(result, modelName);
      logger.debug('ForceTruncate', `强制截断调整: keepTail=${keepTail}, tokens=${currentTokens}/${maxTokens}`);
    }

    // 如果还是超限，只保留最后一条消息
    if (currentTokens > maxTokens) {
      result = [firstUserMsg, warningMessage, messages[messages.length - 1]];
      currentTokens = await estimateMessagesTokens(result, modelName);

      // 如果连这都超限，只保留警告消息和最后一条
      if (currentTokens > maxTokens) {
        result = [warningMessage, messages[messages.length - 1]];
      }
    }
  }

  logger.warn('ForceTruncate', `强制截断: ${messages.length} → ${result.length} 条消息`);

  return result;
}
