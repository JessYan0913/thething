// ============================================================
// Compaction Module - Entry Point
// ============================================================
// 每步自动压缩 + 闸门强制。统一为 Agent 驱动的单一压缩路径(P2):
//   Layer 0: 跨步压缩视图(前缀替换,O(1)) -- 已有摘要则直接套用
//   Layer 2: 工具输出生命周期管理(老化 + 落盘找回,同步,微秒级)
//   ② Agent 压缩(主模型,真实消息,按 W 裁定输入,默认成功)
//   ③ 闸门:压缩后仍超限 -> 抛 CONTEXT_BUDGET_EXCEEDED(pipeline.ts 接,413)
//
// forceTruncate 已删:它静默砍中间 prose(抖音式丢失),现由闸门显式 413 兜底。
// 见 docs/context-compaction-redesign.md。

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';

import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageToolOutputLifecycle } from './lifecycle';
import { estimateFullRequest } from './token-counter';
import { estimateTokensIncremental, type CachedEstimation } from './incremental-estimation';
import type { Tool } from 'ai';
import { agentCompress, findCompressionSplit, KEEP_PERCENT } from './agent-compress';
import { getModelContextLimit } from '../../services/model';
import { logger } from '../../primitives/logger';
import { applyCompactionView, updateViewAfterL3 } from './compaction-view';
import type { CompactionView } from './compaction-view';
import type { CompactionTelemetry } from './compaction-telemetry';

// ============================================================
// Main Entry Point: compactBeforeStep
// ============================================================

/**
 * prepareStep 中调用：每步 API 调用前的上下文管理
 */
export async function compactBeforeStep(
  messages: import('ai').ModelMessage[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    conversationId: string;
    dataStore: DataStore;
    instructionsTokens?: number;
    toolsTokens?: number;
    contextLimit?: number;
    /** 提供时 Layer 2 压缩的原始输出落盘可找回 */
    storage?: { sessionId: string; dataDir: string };
    /** 流式输出 writer，压缩完成后发送上下文水位数据给前端 */
    writer?: {
      write: (chunk: unknown) => void;
    };
    /** 工具列表，用于估算 token */
    tools?: Record<string, Tool>;
    /** 系统提示词，用于估算 token */
    instructions?: string;
    /** 跨步骤压缩视图（记录已被 L3 摘要覆盖的前缀） */
    compactionView?: CompactionView;
    /** 遥测收集器 */
    telemetry?: CompactionTelemetry;
    /** 上次估算结果（用于增量估算，避免重复计算未变化的部分） */
    lastEstimation?: CachedEstimation;
    /** 更新估算缓存的回调 */
    onEstimationUpdated?: (estimation: CachedEstimation) => void;
  },
): Promise<import('ai').ModelMessage[]> {
  let current = messages;

  // ══════════════════════════════════════════════════════════
  // Layer 0: 应用跨步骤压缩视图（零 LLM 调用，O(1) 前缀替换）
  // ══════════════════════════════════════════════════════════
  if (context.compactionView) {
    const viewResult = applyCompactionView(current, context.compactionView);
    if (viewResult.applied) {
      current = viewResult.messages;
      logger.info('Compaction', `View applied: ${messages.length} -> ${current.length} messages`);
      // 视图生效，前缀已被摘要替换，跳过后续 Layer
      return current;
    }
  }

  // ── Layer 2: 工具输出生命周期管理（同步，微秒级）──
  const lifecycle = manageToolOutputLifecycle(current, config.lifecycle, context.storage);
  current = lifecycle.messages;
  // 落盘异步进行,不阻塞主流程;等待写盘完成以保证元信息中的路径可读
  if (lifecycle.persistence) {
    await lifecycle.persistence;
  }

  // ── 预算检查：是否需要进一步压缩？ ──
  if (context.tools && context.instructions) {
    // 使用增量估算（如果有缓存）
    const cachedEstimation = await estimateTokensIncremental(
      current,
      context.instructions,
      context.tools,
      context.modelName,
      {
        previousEstimation: context.lastEstimation,
        contextLimit: context.contextLimit,
      },
    );

    // 从 CachedEstimation 构建 estimation
    const estimation = {
      totalTokens: cachedEstimation.totalTokens,
      modelLimit: cachedEstimation.modelLimit,
      utilizationPercent: cachedEstimation.utilizationPercent,
      exceedsLimit: cachedEstimation.exceedsLimit,
    };

    // 更新缓存
    if (context.onEstimationUpdated) {
      context.onEstimationUpdated(cachedEstimation);
    }

    // 发送水位数据给前端
    if (context.writer) {
      try {
        context.writer.write({
          type: 'custom',
          kind: 'data.budget',
          providerMetadata: {
            budget: {
              usagePercentage: estimation.utilizationPercent,
              totalTokens: estimation.totalTokens,
              modelLimit: estimation.modelLimit,
            },
          },
        } as any);
      } catch (err) {
        // 估算失败不阻塞主流程
      }
    }

    // 如果 Layer 2 后仍超限，启动 Agent 压缩（②）
    if (estimation.exceedsLimit) {
      logger.warn(
        'Compaction',
        `Layer 2 后仍超限 (${estimation.utilizationPercent.toFixed(1)}%)，启动 Agent 压缩`,
      );

      current = await applyEmergencyCompression(current, {
        ...context,
        tools: context.tools,
        instructions: context.instructions,
        targetTokens: estimation.modelLimit * 0.8, // 目标 80% 利用率
      });
    }
  }

  return current;
}

/**
 * Agent 压缩（②）：主模型读真实消息生成摘要,替换被压缩前缀。
 *
 * 导出供 budget-check 使用，确保初始预算检查和运行时压缩使用相同逻辑。
 * 失败 / 仍超限 -> 返回原消息,由闸门 413 兜底(不 forceTruncate)。
 */
export async function applyEmergencyCompression(
  messages: import('ai').ModelMessage[],
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    conversationId?: string;
    dataStore?: DataStore;
    contextLimit?: number;
    tools: Record<string, Tool>;
    instructions: string;
    targetTokens: number;
    compactionView?: CompactionView;
    telemetry?: CompactionTelemetry;
  },
): Promise<import('ai').ModelMessage[]> {
  // 1. 找已有锚点(增量):只压锚点之后的新消息(仅首轮查 summaryStore)
  let firstStartIndex = 0;
  if (context.conversationId && context.dataStore) {
    try {
      const stored = context.dataStore.summaryStore.getSummaryByConversation(context.conversationId);
      if (stored?.anchorMessageId) {
        const idx = messages.findIndex(
          (m) => (m as unknown as { id?: string }).id === stored.anchorMessageId,
        );
        if (idx >= 0) firstStartIndex = idx + 1;
      }
    } catch {
      /* ignore, 按无锚点处理 */
    }
  }

  const windowLimit = getModelContextLimit(context.modelName, context.contextLimit);

  // 2. 多轮压缩:一轮压完仍超限就再压(每轮尾部保留 ≈30%,30% -> 9% -> 2.7% 快速收敛)。
  //    只在能继续压(待压段 >= 2 条)且摘要成功时继续;否则停止,交闸门 413(不 forceTruncate)。
  let current = messages;
  let startIndex = firstStartIndex;
  const MAX_ROUNDS = 3;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const splitIndex = await findCompressionSplit(current, startIndex, windowLimit, context.modelName, Math.pow(KEEP_PERCENT, round + 1));
    const olderMessages = current.slice(startIndex, splitIndex);
    if (olderMessages.length < 2) {
      logger.warn('Compaction', `第 ${round + 1} 轮待压缩段不足 2 条,停止重压缩(交闸门)`);
      break;
    }
    const anchorIndex = splitIndex - 1;
    const anchorMessageId = (olderMessages[olderMessages.length - 1] as unknown as { id?: string }).id;
    const beforeLen = current.length;

    const result = await agentCompress(olderMessages, {
      model: context.model,
      fallbackModels: context.fallbackModels,
      modelName: context.modelName,
      contextLimit: context.contextLimit, // 分块预算按当前窗口 W 裁定
      conversationId: context.conversationId,
      dataStore: context.dataStore,
      anchorMessageId, // 有 .id 才落库(供重载)
    });

    if (!result.success || !result.summaryMessage || !result.summaryText) {
      logger.warn('Compaction', `第 ${round + 1} 轮摘要失败,停止重压缩(交闸门,不 forceTruncate)`);
      break;
    }

    // ② in->out 明细由 agentCompress 内部记([②] chunks=N in=..tok out=..);此处只记 round 级
    logger.info(
      'Compaction',
      `[round=${round + 1}] anchorIdx=${anchorIndex} persisted=${!!anchorMessageId} | conv=${context.conversationId ?? '?'}`,
    );

    const anchorMsg = current[anchorIndex];
    current = [result.summaryMessage, ...current.slice(splitIndex)] as import('ai').ModelMessage[];

    // 更新 compactionView(跨步前缀替换优化;多轮时末轮的摘要为最终态,last wins)
    if (context.compactionView) {
      updateViewAfterL3(
        context.compactionView,
        result.summaryMessage,
        anchorIndex,
        anchorMsg,
        result.summaryText,
      );
    }

    context.telemetry?.recordLayer3Triggered({
      reason: !context.compactionView?.summary ? 'no_view' : 'budget_exceeded',
      messagesBeforeCompaction: beforeLen,
      messagesAfterCompaction: current.length,
      durationMs: 0,
    });

    const afterSummary = await estimateFullRequest(
      current,
      context.instructions,
      context.tools,
      context.modelName,
      context.contextLimit,
    );

    if (!afterSummary.exceedsLimit) {
      logger.info('Compaction', `Agent 压缩成功(${round + 1} 轮): 降至 ${afterSummary.utilizationPercent.toFixed(1)}%`);
      return current;
    }
    // 非消息部分(指令/工具/输出预留)单独就占满窗口 -> 压缩消息无济于事,停止重压缩(交闸门)
    if (afterSummary.totalTokens - afterSummary.messagesTokens >= windowLimit) {
      logger.warn('Compaction', `第 ${round + 1} 轮后非消息部分已占满窗口(${afterSummary.totalTokens - afterSummary.messagesTokens} >= ${windowLimit}),压缩无法解,交闸门`);
      break;
    }
    logger.warn(
      'Compaction',
      `第 ${round + 1} 轮后仍超限 (${afterSummary.utilizationPercent.toFixed(1)}%),${round + 1 < MAX_ROUNDS ? '继续重压缩' : '已达上限,交闸门'}`,
    );
    // 后续轮从 0 开始压:前一轮的摘要在 current[0],纳入再压(摘要的摘要)
    startIndex = 0;
  }

  logger.warn('Compaction', '重压缩后仍超限,交由闸门 413 兜底(不 forceTruncate)');
  return current;
}

// ============================================================
// Minimal Re-exports (barrel surface)
// ============================================================
// 内部消费者直接 import 子模块（如 ../compaction/types）。
// 此 barrel 仅导出外部 API 需要的符号。

export { manageToolOutputLifecycle } from './lifecycle';
export { estimateMessagesTokens } from './token-counter';
export { generateConversationTitle } from './title-generator';
export { handleReactiveRetry, isContextLengthError } from './retry';
export { applyCheckpointOnLoad, CHECKPOINT_SUMMARY_ID_PREFIX } from './checkpoint';
export { agentCompress, findCompressionSplit } from './agent-compress';
export { fingerprintMessage } from './compaction-view';
