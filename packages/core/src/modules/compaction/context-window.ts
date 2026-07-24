// ============================================================
// Context Window - 摘要质量校验
// ============================================================
// 摘要生成逻辑已收敛到 agent-compress.ts(统一 Agent 驱动压缩器)。
// 本文件仅保留 validateSummaryQuality--语言无关的摘要质量校验,
// 供 agentCompress 在落库前拒绝空/超长/整段复制的摘要。
//
// 见 docs/context-compaction-redesign.md P2。

import { extractMessageText } from './token-counter';
import { logger } from '../../primitives/logger';

/** 摘要最长字符数(超出视为整段复制原文,拒绝) */
const MAX_SUMMARY_LENGTH = 6000;

/**
 * 校验摘要质量:非空、不超长、不是任意单条消息的原文复制。
 *
 * @param summary 待校验摘要
 * @param messages 被压缩的原始消息(用于复制检测)
 */
export function validateSummaryQuality(summary: string, messages: import('ai').ModelMessage[]): boolean {
  if (!summary || summary.length < 20) return false;
  if (summary.length > MAX_SUMMARY_LENGTH) {
    logger.warn('ContextWindow', `Summary too long (${summary.length} chars), likely copying content`);
    return false;
  }

  // 简单复制检测：摘要不应是任意单条消息的原文复制
  const allTexts = messages.map((m) => extractMessageText(m));
  for (const text of allTexts) {
    if (text && text.length > 10 && summary.includes(text)) {
      logger.warn('ContextWindow', 'Summary contains verbatim copy of a message');
      return false;
    }
  }

  return true;
}
