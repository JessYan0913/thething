// ============================================================
// Compaction Module - Entry Point
// ============================================================
// compactBeforeStep：每步 API 调用前的上下文管理。
// 编排简化为三步：selfHeal -> applyCompactionView -> manageCompaction(一次)。
// 压缩决策（Layer 2 + 紧急压缩）收敛进 lifecycle.ts 的 manageCompaction
// 统一分配器，不再由本文件编排多层。见 docs/compaction-road-to-excellent.md 差距一。

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';

import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageCompaction } from './lifecycle';
import type { Tool } from 'ai';
import { logger } from '../../primitives/logger';
import { applyCompactionView } from './compaction-view';
import type { CompactionView } from './compaction-view';
import type { CompactionTelemetry } from './compaction-telemetry';
import type { ContextLedger } from './context-ledger';
import type { CachedEstimation } from './incremental-estimation';
import { selfHealOrphanedCheckpoint } from './checkpoint';

// ============================================================
// Main Entry Point: compactBeforeStep
// ============================================================

/**
 * prepareStep 中调用：每步 API 调用前的上下文管理。
 * 编排：selfHeal -> applyCompactionView -> manageCompaction(一次)。
 * 压缩决策（Layer 2 + 紧急压缩）在 lifecycle.ts 的 manageCompaction 统一分配器内。
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
    storage?: { sessionId: string; dataDir: string };
    writer?: { write: (chunk: unknown) => void };
    tools?: Record<string, Tool>;
    instructions?: string;
    compactionView?: CompactionView;
    telemetry?: CompactionTelemetry;
    ledger?: ContextLedger;
    lastEstimation?: CachedEstimation;
    onEstimationUpdated?: (estimation: CachedEstimation) => void;
  },
): Promise<import('ai').ModelMessage[]> {
  let current = messages;

  // 1. 孤儿锚点自愈（首轮 API 调用前，有 model 访问）
  if (context.dataStore && context.model) {
    current = await selfHealOrphanedCheckpoint(current, {
      conversationId: context.conversationId,
      dataStore: context.dataStore,
      model: context.model,
      fallbackModels: context.fallbackModels,
      modelName: context.modelName,
      contextLimit: context.contextLimit,
    });
  }

  // 2. 跨步骤压缩视图（O(1) 前缀替换，命中则提前返回）
  if (context.compactionView) {
    const viewResult = applyCompactionView(current, context.compactionView);
    if (viewResult.applied) {
      current = viewResult.messages;
      logger.info('Compaction', `View applied: ${messages.length} -> ${current.length} messages`);
      return current;
    }
  }

  // 3. 统一分配器（一次调用，内部按预算选档：Layer 2 -> 确定性摘要 -> LLM 摘要 -> 截断）
  const result = await manageCompaction(current, config.lifecycle, {
    model: context.model,
    fallbackModels: context.fallbackModels,
    modelName: context.modelName,
    contextLimit: context.contextLimit,
    instructions: context.instructions,
    tools: context.tools,
    storage: context.storage,
    ledger: context.ledger,
    telemetry: context.telemetry,
    compactionView: context.compactionView,
    lastEstimation: context.lastEstimation,
  });
  current = result.messages;

  // 4. 副信号：发送水位给前端 + 更新估算缓存
  if (result.cachedEstimation) {
    if (context.onEstimationUpdated) {
      context.onEstimationUpdated(result.cachedEstimation);
    }
    if (context.writer) {
      try {
        context.writer.write({
          type: 'custom',
          kind: 'data.budget',
          providerMetadata: {
            budget: {
              usagePercentage: result.cachedEstimation.utilizationPercent,
              totalTokens: result.cachedEstimation.totalTokens,
              modelLimit: result.cachedEstimation.modelLimit,
            },
          },
        } as any);
      } catch {
        // 估算失败不阻塞主流程
      }
    }
  }

  return current;
}

// ============================================================
// Minimal Re-exports (barrel surface)
// ============================================================
// 内部消费者直接 import 子模块（如 ../compaction/types）。
// 此 barrel 仅导出外部 API 需要的符号。

export { manageToolOutputLifecycle, manageCompaction, applyEmergencyCompression } from './lifecycle';
export { estimateMessagesTokens } from './token-counter';
export { generateConversationTitle } from './title-generator';
export { handleReactiveRetry, isContextLengthError } from './retry';
export { applyCheckpointOnLoad, CHECKPOINT_SUMMARY_ID_PREFIX, maybeCheckpointAfterRun, selfHealOrphanedCheckpoint } from './checkpoint';
export { compressMessagesDeterministic, forceTruncateMessages } from './message-compressor';
export { emergencySummarize } from './emergency-summary';
export { fingerprintMessage } from './compaction-view';
export { ContextLedger } from './context-ledger';
export { extractActionLog, renderActionLog, renderKeysOnlyActionLog } from './action-log';
