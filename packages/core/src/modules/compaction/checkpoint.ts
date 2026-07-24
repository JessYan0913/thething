// ============================================================
// Compaction Checkpoint - 从 checkpoint 之后加载历史
// ============================================================
// 加载会话历史时,如果存在 compaction checkpoint(已存摘要 + 锚点消息 id),
// 直接返回 [摘要消息, ...锚点之后的消息],而非全量历史。这样:
//   - 发给 API 的前缀稳定 -> 改善 prompt cache 命中
//   - 无需每次请求重跑 LLM 摘要
//
// 安全前提:DB 始终保存全量历史(压缩只在内存中对模型请求生效)。
// 因此本函数纯属叠加优化--锚点找不到 / 无摘要 / 任何异常,一律回退全量历史,
// 绝不丢失消息。见 docs/context-compaction-analysis.md E。

import { convertToModelMessages, type UIMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';

import { logger } from '../../primitives/logger';
import { estimateMessagesTokens } from './token-counter';
import { getModelContextLimit } from '../../services/model';
import { agentCompress, findCompressionSplit } from './agent-compress';
import { buildSummaryMessage } from './message-view';

/**
 * @deprecated 使用 buildSummaryMessage (message-view.ts) 统一构造。
 * 保留常量以兼容外部引用。
 */
export const CHECKPOINT_SUMMARY_ID_PREFIX = 'summary-';

/**
 * 构建 checkpoint 摘要消息（UIMessage 格式）。
 * 格式收敛到 buildSummaryMessage，调用方显式声明 format。
 */
function buildCheckpointSummaryMessage(summary: string): UIMessage {
  return buildSummaryMessage(summary, 'ui') as unknown as UIMessage;
}

/**
 * Checkpoint 加载结果
 */
export interface CheckpointLoadResult {
  /** 是否应用了 checkpoint */
  applied: boolean;
  /** 压缩后的消息列表 */
  messages: UIMessage[];
  /** 摘要消息（用于视图初始化） */
  summaryMessage?: UIMessage;
  /** 锚点索引（用于视图初始化） */
  anchorIndex?: number;
  /** 摘要正文（用于视图初始化） */
  summaryText?: string;
}

/**
 * 应用 compaction checkpoint:若有可用 checkpoint,返回压缩后的历史;否则原样返回。
 *
 * @param fullMessages 全量历史消息(来自 DB)
 * @param conversationId 会话 id
 * @param dataStore 数据存储
 * @returns Checkpoint 加载结果
 */
export function applyCheckpointOnLoad(
  fullMessages: UIMessage[],
  conversationId: string,
  dataStore: DataStore,
): CheckpointLoadResult {
  try {
    const stored = dataStore.summaryStore.getSummaryByConversation(conversationId);
    if (!stored || !stored.summary || !stored.anchorMessageId) {
      return { applied: false, messages: fullMessages }; // 无摘要或无锚点 -> 全量
    }

    const anchorIndex = fullMessages.findIndex(
      (m) => (m as unknown as { id?: string }).id === stored.anchorMessageId,
    );
    // 锚点找不到(消息被删/id 变更),或锚点已是最后一条(无可保留的后段)-> 全量
    if (anchorIndex < 0) {
      logger.debug('Checkpoint', `anchor ${stored.anchorMessageId} not found, loading full history`);
      return { applied: false, messages: fullMessages };
    }

    const newerMessages = fullMessages.slice(anchorIndex + 1);
    // 锚点之后没有新消息 -> 没必要压缩,返回全量(避免只发一条摘要)
    if (newerMessages.length === 0) {
      return { applied: false, messages: fullMessages };
    }

    const summaryMessage = buildCheckpointSummaryMessage(stored.summary);
    return {
      applied: true,
      messages: [summaryMessage, ...newerMessages],
      summaryMessage,
      anchorIndex,
      summaryText: stored.summary,
    };
  } catch (err) {
    // 任何异常 -> 回退全量,绝不丢历史
    logger.warn('Checkpoint', 'applyCheckpointOnLoad failed, loading full history:', err);
    return { applied: false, messages: fullMessages };
  }
}

// ============================================================
// 后台 checkpoint:运行结束后生成摘要落库
// ============================================================
// 濒死时刻(budget 超限)才做摘要有三个致命弱点:
//   1. 超限时输入本身可能太大,摘要请求也会失败(2026-07-21 事故:66s 两次尝试全失败)
//   2. 用户在等待,同步摘要拖慢响应
//   3. 一旦失败,checkpoint 永远落不了库(历史 4 条摘要锚点全空)
// 改为运行结束后异步判定:活跃路径超过水位线就在后台生成摘要 + 锚点落库,
// 下次加载直接命中 applyCheckpointOnLoad,budget 检查天然通过。
//
// P2:摘要由统一的 agentCompress(主模型,真实消息)生成,与濒死路径(B)共用同一压缩器。

/** 触发后台 checkpoint 的上下文占比水位线 */
const CHECKPOINT_TRIGGER_PERCENT = 0.5;
/** 锚点之后至少保留的消息条数 */
const MIN_KEEP_MESSAGES = 2;

/**
 * 运行结束后判定并生成 checkpoint(供 finalize/onEnd 后台调用)。
 *
 * @param activeMessages 当前活跃路径全量消息(UIMessage)
 * @returns 是否成功落库了新 checkpoint
 */
export async function maybeCheckpointAfterRun(
  activeMessages: UIMessage[],
  context: {
    conversationId: string;
    dataStore: DataStore;
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    contextLimit?: number;
  },
): Promise<boolean> {
  try {
    if (activeMessages.length < MIN_KEEP_MESSAGES + 2) return false;

    const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);
    const totalTokens = await estimateMessagesTokens(activeMessages as unknown as import('ai').ModelMessage[], context.modelName);
    if (totalTokens < contextLimit * CHECKPOINT_TRIGGER_PERCENT) return false;

    // 从已有 checkpoint 锚点之后开始(增量);无锚点则从头
    const stored = context.dataStore.summaryStore.getSummaryByConversation(context.conversationId);
    let startIndex = 0;
    if (stored?.anchorMessageId) {
      const idx = activeMessages.findIndex((m) => m.id === stored.anchorMessageId);
      if (idx >= 0) startIndex = idx + 1;
    }

    // 共享切分:尾部保留,其余进摘要段(与濒死路径用同一 findCompressionSplit)
    const splitIndex = await findCompressionSplit(
      activeMessages as unknown as import('ai').ModelMessage[],
      startIndex,
      contextLimit,
      context.modelName,
    );
    const olderMessages = activeMessages.slice(startIndex, splitIndex);
    if (olderMessages.length === 0) return false;

    const anchorMessageId = olderMessages[olderMessages.length - 1].id;
    if (!anchorMessageId) return false;

    // 转成 ModelMessage 喂给主模型(真实结构,不拍扁、不 slice)
    const olderModelMessages = await convertToModelMessages(olderMessages);

    const result = await agentCompress(olderModelMessages, {
      model: context.model,
      fallbackModels: context.fallbackModels,
      modelName: context.modelName,
      contextLimit: context.contextLimit, // 分块预算按当前窗口 W 裁定
      conversationId: context.conversationId,
      dataStore: context.dataStore,
      anchorMessageId, // Path A:落库供重载
    });
    if (result.success) {
      logger.info(
        'Checkpoint',
        `Background checkpoint saved for ${context.conversationId}: ` +
        `anchor=${anchorMessageId}, summarized ${olderMessages.length} messages (${totalTokens} tokens total)`,
      );
    }
    return result.success;
  } catch (err) {
    // 后台任务,失败无害,下次运行结束再试
    logger.warn('Checkpoint', 'maybeCheckpointAfterRun failed:', err);
    return false;
  }
}
