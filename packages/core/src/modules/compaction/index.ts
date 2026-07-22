// ============================================================
// Compaction Module - Entry Point
// ============================================================
// 源头管理，每步自动替换旧工具输出为结构化元信息
//
// compactBeforeStep 执行顺序：
// 1. Layer 2: 工具输出生命周期管理 (同步，微秒级)
// 2. 跨消息预算检查 (吸收原 enforceToolResultBudget)
// 注: Layer 1 (compact_tool_result) 和 Layer 3 (同步 LLM 摘要) 已删除。
//     超过上下文窗口 → 闸门 413 诚实拒绝。

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import type { PipelineMessage } from '../../services/config/compaction-types';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageToolOutputLifecycle } from './lifecycle';
import { estimateFullRequest } from './token-counter';
import type { Tool } from 'ai';

// ============================================================
// Main Entry Point: compactBeforeStep
// ============================================================

/**
 * prepareStep 中调用：每步 API 调用前的上下文管理
 */
export async function compactBeforeStep(
  messages: PipelineMessage[],
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
  },
): Promise<PipelineMessage[]> {
  let current = messages;

  // ── Layer 2: 工具输出生命周期管理（同步，微秒级）──
  const lifecycle = manageToolOutputLifecycle(current, config.lifecycle, context.storage);
  current = lifecycle.messages;
  // 落盘异步进行,不阻塞主流程;等待写盘完成以保证元信息中的路径可读
  if (lifecycle.persistence) {
    await lifecycle.persistence;
  }

  // ── 压缩完成后估算当前请求水位，发送给前端 ──
  if (context.writer && context.tools && context.instructions) {
    try {
      const estimation = await estimateFullRequest(
        current,
        context.instructions,
        context.tools,
        context.modelName,
        context.contextLimit,
      );
      context.writer.write({
        type: 'data-budget',
        usagePercentage: estimation.utilizationPercent,
        totalTokens: estimation.totalTokens,
        modelLimit: estimation.modelLimit,
      } as any);
    } catch (err) {
      // 估算失败不阻塞主流程
    }
  }

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
