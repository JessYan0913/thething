// ============================================================
// Compaction View - 跨步骤压缩视图状态机
// ============================================================
// AI SDK v7 的 prepareStep 每步收到完整历史（原有消息 + 新增响应），
// 压缩需要重做。CompactionView 记录"已被 L3 摘要覆盖的前缀"，
// 使后续步骤通过 O(1) 指纹验证直接替换前缀，避免重复调用 LLM。
//
// 核心机制：
// 1. Layer 3 生成摘要后，记录：
//    - summary.message: 稳定 ID 的摘要消息
//    - anchorIndex: 摘要覆盖到第几条原始消息
//    - anchorFingerprint: 锚点消息内容指纹（验证历史未被修改）
// 2. 下一步 prepareStep 中 compactBeforeStep 开头：
//    - 验证 messages[anchorIndex] 的指纹
//    - 如果匹配：[summary, ...messages.slice(anchorIndex+1)]
//    - 如果不匹配：清空视图，回退正常压缩路径
//
// 收益：
// - 零 LLM 调用（跨步骤复用摘要）
// - 前缀逐字节稳定（KV cache 友好）
// - O(1) 前缀替换（vs 重新压缩）

import type { ModelMessage } from 'ai';
import { extractMessageText } from './token-counter';
import { logger } from '../../primitives/logger';

// ============================================================
// 类型定义
// ============================================================

/**
 * 压缩摘要条目
 */
export interface CompactionSummaryEntry {
  /** 稳定 ID 的摘要消息 */
  message: ModelMessage;
  /** 被覆盖区间最后一条消息在原始数组中的下标 */
  anchorIndex: number;
  /** 锚点消息的内容指纹（用于验证下标处仍是同一条消息） */
  anchorFingerprint: string;
  /** 摘要正文（不含标记符，供遥测/调试） */
  summaryText: string;
}

/**
 * 压缩视图
 */
export interface CompactionView {
  summary: CompactionSummaryEntry | null;
}

/**
 * 创建空视图
 */
export function createCompactionView(): CompactionView {
  return { summary: null };
}

// ============================================================
// 消息指纹
// ============================================================

/**
 * 消息内容指纹 — 必须对 L1/L2 工具输出压缩保持稳定
 *
 * 策略：
 * - 含工具调用/结果的消息：role + toolCallId 列表
 *   （压缩只替换 output，toolCallId 不变）
 * - 纯文本消息：role + 文本长度 + 首尾字符片段
 *   （压缩不触碰非工具消息）
 *
 * 为什么不用 message.id：
 * - 同一条消息在格式转换时 id 可能缺失或不一致
 * - 内容指纹在不同格式下保持一致
 */
export function fingerprintMessage(msg: ModelMessage): string {
  const toolCallIds: string[] = [];

  // 从 content 中提取 toolCallId
  const collectFromContent = (content: unknown) => {
    if (!Array.isArray(content)) return;

    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;

      // 工具调用或工具结果
      const isToolPart =
        p.type === 'tool-call' ||
        p.type === 'tool-result' ||
        (typeof p.type === 'string' && p.type.startsWith('tool-'));

      if (isToolPart && typeof p.toolCallId === 'string' && p.toolCallId) {
        toolCallIds.push(p.toolCallId);
      }
    }
  };

  collectFromContent((msg as unknown as Record<string, unknown>).content);

  // 如果包含工具调用，使用 toolCallId 列表作为指纹
  if (toolCallIds.length > 0) {
    return `${msg.role}|tools|${toolCallIds.join(',')}`;
  }

  // 纯文本消息：role + 长度 + 首尾字符
  const text = extractMessageText(msg) ?? '';
  return `${msg.role}|text|${text.length}|${text.slice(0, 80)}|${text.slice(-40)}`;
}

// ============================================================
// 视图应用
// ============================================================

export interface ApplyViewResult {
  messages: ModelMessage[];
  /** 视图是否生效（前缀被摘要替换，或此前已替换过） */
  applied: boolean;
}

/**
 * 把视图应用到本步的原始消息数组：
 * [0..anchorIndex] → view.summary.message
 *
 * 三种结果：
 * 1. 首条消息已是该摘要（如 reactive retry 后的 currentMessages）→ 原样返回，applied=true
 * 2. anchorIndex 处指纹命中 → 替换前缀，applied=true
 * 3. 指纹不匹配 / 数组过短 → 失效视图（view.summary = null），applied=false
 */
export function applyCompactionView(
  messages: ModelMessage[],
  view: CompactionView,
): ApplyViewResult {
  const entry = view.summary;
  if (!entry) {
    return { messages, applied: false };
  }

  // 情况 1: 首条消息已是该摘要
  if (messages.length > 0 && messages[0] === entry.message) {
    logger.debug('CompactionView', 'First message is already the summary, applied=true');
    return { messages, applied: true };
  }

  // 情况 2: 验证锚点指纹
  if (entry.anchorIndex >= messages.length) {
    logger.warn('CompactionView', `Anchor index ${entry.anchorIndex} >= messages.length ${messages.length}, invalidating view`);
    view.summary = null;
    return { messages, applied: false };
  }

  const anchorMsg = messages[entry.anchorIndex];
  const currentFingerprint = fingerprintMessage(anchorMsg);

  if (currentFingerprint !== entry.anchorFingerprint) {
    logger.warn('CompactionView', `Anchor fingerprint mismatch (expected: ${entry.anchorFingerprint.slice(0, 50)}..., got: ${currentFingerprint.slice(0, 50)}...), invalidating view`);
    view.summary = null;
    return { messages, applied: false };
  }

  // 指纹匹配：替换前缀
  const compactedMessages = [entry.message, ...messages.slice(entry.anchorIndex + 1)];
  logger.info('CompactionView', `Applied view: ${messages.length} → ${compactedMessages.length} messages (anchor=${entry.anchorIndex})`);

  return { messages: compactedMessages, applied: true };
}

// ============================================================
// 视图更新
// ============================================================

/**
 * Layer 3 生成摘要后更新视图
 *
 * @param view 当前视图
 * @param summaryMessage 新生成的摘要消息（必须有稳定 ID）
 * @param anchorIndex 摘要覆盖到第几条原始消息
 * @param anchorMessage 锚点消息（用于计算指纹）
 * @param summaryText 摘要正文
 */
export function updateViewAfterL3(
  view: CompactionView,
  summaryMessage: ModelMessage,
  anchorIndex: number,
  anchorMessage: ModelMessage,
  summaryText: string,
): void {
  view.summary = {
    message: summaryMessage,
    anchorIndex,
    anchorFingerprint: fingerprintMessage(anchorMessage),
    summaryText,
  };

  logger.debug('CompactionView', `Updated view: anchorIndex=${anchorIndex}, fingerprint=${view.summary.anchorFingerprint.slice(0, 50)}...`);
}

/**
 * 清空视图（当历史被外部修改或截断时）
 */
export function clearView(view: CompactionView): void {
  view.summary = null;
  logger.debug('CompactionView', 'View cleared');
}
