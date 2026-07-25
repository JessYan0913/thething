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
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';

import { logger } from '../../primitives/logger';
import { estimateMessageTokens, estimateMessagesTokens } from './token-counter';
import { getModelContextLimit } from '../../services/model';
import { generateAndPersistCheckpointSummary } from './context-window';
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
      return { applied: false, messages: fullMessages }; // 无摘要或无锚点 → 全量
    }

    const anchorIndex = fullMessages.findIndex(
      (m) => (m as unknown as { id?: string }).id === stored.anchorMessageId,
    );
    // 锚点找不到(消息被删/id 变更),或锚点已是最后一条(无可保留的后段)→ 全量
    if (anchorIndex < 0) {
      logger.debug('Checkpoint', `anchor ${stored.anchorMessageId} not found, loading full history`);
      return { applied: false, messages: fullMessages };
    }

    const newerMessages = fullMessages.slice(anchorIndex + 1);
    // 锚点之后没有新消息 → 没必要压缩,返回全量(避免只发一条摘要)
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
    // 任何异常 → 回退全量,绝不丢历史
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

/** 触发后台 checkpoint 的上下文占比水位线 */
const CHECKPOINT_TRIGGER_PERCENT = 0.5;
/** checkpoint 后保留完整消息的目标占比 */
const CHECKPOINT_KEEP_PERCENT = 0.3;
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
    /** 强制生成 checkpoint,绕过 50% 水位线(孤儿自愈场景:旧锚点失效,
     *  Layer 2 已把大输出 meta 化、in-memory token 变小,水位线判断不出需要重建) */
    force?: boolean;
  },
): Promise<boolean> {
  try {
    if (activeMessages.length < MIN_KEEP_MESSAGES + 2) return false;

    const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);
    const totalTokens = await estimateMessagesTokens(activeMessages as unknown as import('ai').ModelMessage[], context.modelName);
    // force 时绕过水位线(孤儿自愈:不管 in-memory 多小都要重建,因为旧摘要 anchor 已失效)
    if (!context.force && totalTokens < contextLimit * CHECKPOINT_TRIGGER_PERCENT) return false;

    // 从已有 checkpoint 锚点之后开始摘要(增量);无锚点则从头开始
    const stored = context.dataStore.summaryStore.getSummaryByConversation(context.conversationId);
    let startIndex = 0;
    if (stored?.anchorMessageId) {
      const idx = activeMessages.findIndex((m) => m.id === stored.anchorMessageId);
      if (idx >= 0) startIndex = idx + 1;
    }

    // 从末尾往前保留 ≈ KEEP_PERCENT 的 token,其余进入摘要段
    const keepBudget = contextLimit * CHECKPOINT_KEEP_PERCENT;
    let kept = 0;
    let splitIndex = activeMessages.length;
    for (let i = activeMessages.length - 1; i > startIndex; i--) {
      kept += await estimateMessageTokens(activeMessages[i] as unknown as import('ai').ModelMessage, context.modelName);
      if (kept >= keepBudget) { splitIndex = i; break; }
      splitIndex = i;
    }
    // 尾部至少保留 MIN_KEEP_MESSAGES 条
    splitIndex = Math.min(splitIndex, activeMessages.length - MIN_KEEP_MESSAGES);

    const olderMessages = activeMessages.slice(startIndex, splitIndex);
    if (olderMessages.length === 0) return false;

    const anchorMessageId = olderMessages[olderMessages.length - 1].id;
    if (!anchorMessageId) return false;

    const ok = await generateAndPersistCheckpointSummary(
      olderMessages as unknown as import('ai').ModelMessage[],
      {
        model: context.model,
        fallbackModels: context.fallbackModels,
        conversationId: context.conversationId,
        dataStore: context.dataStore,
        anchorMessageId,
      },
    );
    if (ok) {
      logger.info(
        'Checkpoint',
        `Background checkpoint saved for ${context.conversationId}: ` +
        `anchor=${anchorMessageId}, summarized ${olderMessages.length} messages (${totalTokens} tokens total)`,
      );
    }
    return ok;
  } catch (err) {
    // 后台任务,失败无害,下次运行结束再试
    logger.warn('Checkpoint', 'maybeCheckpointAfterRun failed:', err);
    return false;
  }
}

// ============================================================
// 孤儿锚点自愈
// ============================================================
// regenerate/edit 会让旧 checkpoint 的 anchor 消失出活跃链(变成孤儿分支)。
// applyCheckpointOnLoad 找不到 anchor -> 回退全量历史 -> Layer 2 把旧大输出(如
// 1MB 的 read-loop 消息)meta 化成"Read X -> N lines [saved to: call-*.txt]"。
// 这些 meta 行里的文件路径会污染模型上下文,把"这个项目"等歧义指令带偏。
//
// 50% 水位线判断不出这个问题:Layer 2 meta 化后 in-memory token 变小,水位线以下
// 不会生成新 checkpoint,孤儿一直存在。自愈在 compactBeforeStep(有 model 访问、
// 首轮 API 调用前)检测孤儿 -> 强制重建 checkpoint -> 应用,用语义摘要替换污染 meta。
// 见 docs/context-compaction-architecture.md 读循环事故复盘。

/**
 * 检测并修复孤儿 checkpoint。无孤儿时原样返回;有孤儿时强制重建 checkpoint 并应用。
 *
 * 判定基于 DB 全量历史(而非传入的已压缩消息):applyCheckpointOnLoad 应用后,
 * 传入消息已不含 anchor(被摘要替换),但 DB 全量里仍含 -> 不算孤儿,避免重入。
 */
export async function selfHealOrphanedCheckpoint(
  fullMessages: import('ai').ModelMessage[],
  context: {
    conversationId: string;
    dataStore: DataStore;
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    contextLimit?: number;
  },
): Promise<import('ai').ModelMessage[]> {
  try {
    const stored = context.dataStore.summaryStore.getSummaryByConversation(context.conversationId);
    // 无 checkpoint 或无 anchor -> 无孤儿概念,走全量(由调用方正常流程处理)
    if (!stored || !stored.anchorMessageId) return fullMessages;

    // 用 DB 全量历史判定 anchor 是否还在活跃链(而非传入的已压缩消息)
    const dbMessages = context.dataStore.messageStore.getMessagesByConversation(context.conversationId) as unknown as import('ai').ModelMessage[];
    const anchorInDb = dbMessages.some((m) => (m as unknown as { id?: string }).id === stored.anchorMessageId);
    if (anchorInDb) return fullMessages; // anchor 有效,无需自愈

    // 孤儿:旧 anchor 不在活跃链(regenerate/edit 产生孤儿分支)。强制重建 checkpoint。
    logger.info(
      'Checkpoint',
      `Orphan anchor ${stored.anchorMessageId} detected for ${context.conversationId} - self-healing (force checkpoint)`,
    );
    const ok = await maybeCheckpointAfterRun(dbMessages as unknown as UIMessage[], { ...context, force: true });
    if (!ok) return fullMessages; // 重建失败(如 LLM 报错)-> 回退全量,不丢历史

    // 重新应用 checkpoint:用新摘要替换污染的旧前缀
    const result = applyCheckpointOnLoad(fullMessages as unknown as UIMessage[], context.conversationId, context.dataStore);
    if (result.applied) {
      logger.info('Checkpoint', `Self-heal applied: ${fullMessages.length} -> ${result.messages.length} messages`);
      return result.messages as unknown as import('ai').ModelMessage[];
    }
    return fullMessages;
  } catch (err) {
    // 自愈失败不阻塞主流程,回退全量
    logger.warn('Checkpoint', 'selfHealOrphanedCheckpoint failed:', err);
    return fullMessages;
  }
}
