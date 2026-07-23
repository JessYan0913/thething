// ============================================================
// Compaction Module - Entry Point
// ============================================================
// 源头管理，每步自动替换旧工具输出为结构化元信息
//
// compactBeforeStep 执行顺序：
// 1. Layer 2: 工具输出生命周期管理 (同步，微秒级)
// 2. Layer 2.5: 确定性文本压缩 (若 Layer 2 后仍超限)
// 3. Layer 3: 紧急 LLM 摘要 (若 Layer 2.5 后仍超限，带超时保护)
// 4. 降级: 强制截断 (保底方案，保证永不返回 413)
// 注: Layer 1 (compact_tool_result) 已删除。

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';

import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageToolOutputLifecycle } from './lifecycle';
import { estimateFullRequest } from './token-counter';
import { estimateTokensIncremental, type CachedEstimation } from './incremental-estimation';
import type { Tool } from 'ai';
import { compressMessagesDeterministic, forceTruncateMessages } from './message-compressor';
import { emergencySummarize } from './emergency-summary';
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
      logger.info('Compaction', `View applied: ${messages.length} → ${current.length} messages`);
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

    // 如果 Layer 2 后仍超限，启动紧急压缩流程
    if (estimation.exceedsLimit) {
      logger.warn(
        'Compaction',
        `Layer 2 后仍超限 (${estimation.utilizationPercent.toFixed(1)}%)，启动紧急压缩`,
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
 * 紧急压缩流程：Layer 2.5 → Layer 3 → 降级
 *
 * 导出供 budget-check 使用，确保初始预算检查和运行时压缩使用相同的紧急压缩逻辑
 */
export async function applyEmergencyCompression(
  messages: import('ai').ModelMessage[],
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    contextLimit?: number;
    tools: Record<string, Tool>;
    instructions: string;
    targetTokens: number;
    compactionView?: CompactionView;
    telemetry?: CompactionTelemetry;
  },
): Promise<import('ai').ModelMessage[]> {
  let current = messages;

  // ── Step 1: Layer 2.5 - 确定性文本压缩 ──
  logger.info('Compaction', 'Step 1: Layer 2.5 - 确定性文本压缩');

  const deterministicResult = await compressMessagesDeterministic(
    current,
    context.targetTokens,
    context.modelName,
  );

  current = deterministicResult.messages;

  const afterDeterministic = await estimateFullRequest(
    current,
    context.instructions,
    context.tools,
    context.modelName,
    context.contextLimit,
  );

  if (!afterDeterministic.exceedsLimit) {
    logger.info(
      'Compaction',
      `Layer 2.5 成功: 释放 ${deterministicResult.tokensFreed} tokens，降至 ${afterDeterministic.utilizationPercent.toFixed(1)}%`,
    );
    return current;
  }

  // ── Step 2: Layer 3 - 紧急 LLM 摘要 ──
  logger.warn(
    'Compaction',
    `Layer 2.5 后仍超限 (${afterDeterministic.utilizationPercent.toFixed(1)}%)，启动 Layer 3`,
  );

  const summaryResult = await emergencySummarize(current, {
    model: context.model,
    fallbackModels: context.fallbackModels,
    targetPercent: 0.6, // 压缩到 60%
  });

  if (summaryResult.success) {
    current = summaryResult.messages;

    // 🆕 更新视图（如果提供了 compactionView）
    if (context.compactionView && summaryResult.summaryMessage && summaryResult.anchorIndex != null) {
      updateViewAfterL3(
        context.compactionView,
        summaryResult.summaryMessage,
        summaryResult.anchorIndex,
        messages[summaryResult.anchorIndex],
        summaryResult.summaryText!,
      );
      logger.debug('Compaction', `View updated: anchorIndex=${summaryResult.anchorIndex}`);
    }

    // 🆕 记录 Layer 3 遥测
    const reason = !context.compactionView?.summary ? 'no_view' : 'budget_exceeded';
    context.telemetry?.recordLayer3Triggered({
      reason,
      messagesBeforeCompaction: messages.length,
      messagesAfterCompaction: current.length,
      durationMs: 0, // TODO: 添加计时
    });

    const afterSummary = await estimateFullRequest(
      current,
      context.instructions,
      context.tools,
      context.modelName,
      context.contextLimit,
    );

    if (!afterSummary.exceedsLimit) {
      logger.info(
        'Compaction',
        `Layer 3 成功: 降至 ${afterSummary.utilizationPercent.toFixed(1)}%`,
      );
      return current;
    }
  }

  // ── Step 3: 降级 - 强制截断 ──
  logger.error('Compaction', '所有压缩策略失败，执行强制截断（保底方案）');

  // 传入 modelName 和 targetTokens，确保强制截断后一定能满足预算
  return await forceTruncateMessages(
    current,
    0.15,
    context.modelName,
    context.targetTokens,
  );
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
export { compressMessagesDeterministic, forceTruncateMessages } from './message-compressor';
export { emergencySummarize } from './emergency-summary';
export { fingerprintMessage } from './compaction-view';