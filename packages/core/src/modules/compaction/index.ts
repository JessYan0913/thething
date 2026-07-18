// ============================================================
// Compaction Module - Entry Point
// ============================================================
// 源头管理，每步自动替换旧工具输出为结构化元信息
//
// compactBeforeStep 执行顺序：
// 1. Layer 1: 应用 Agent 主动释放的工具输出 (pendingCompactIds)
// 2. Layer 2: 工具输出生命周期管理 (同步，微秒级)
// 3. Layer 3: 上下文窗口检查 (异步，极少触发)

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import type { ToolOutputState } from '../session/interfaces';
import type { PipelineMessage } from '../../services/config/compaction-types';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageToolOutputLifecycle, extractToolMeta } from './lifecycle';
import { enforceContextWindow } from './context-window';
import { estimateMessagesTokens } from './token-counter';
import { getModelContextLimit, getDefaultOutputTokens } from '../../services/model';
import type { CompactedToolResult } from './types';
import { getToolOutputString, unwrapOutput } from './message-utils';

// ============================================================
// Main Entry Point: compactBeforeStep
// ============================================================

/**
 * prepareStep 中调用：每步 API 调用前的上下文管理
 */
export async function compactBeforeStep(
  messages: PipelineMessage[],
  toolOutputState: ToolOutputState,
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
    /** usage 反馈校准系数(见 F);应用到 Layer 3 触发判断,默认 1 */
    calibration?: number;
  },
): Promise<PipelineMessage[]> {
  let current = messages;

  // ── Layer 1: 应用 Agent 主动释放 ──
  if (toolOutputState.pendingCompactIds && toolOutputState.pendingCompactIds.length > 0) {
    current = applyPendingCompactions(current, toolOutputState.pendingCompactIds);
    toolOutputState.pendingCompactIds = [];
  }

  // ── Layer 2: 工具输出生命周期管理（同步，微秒级）──
  const lifecycle = manageToolOutputLifecycle(current, config.lifecycle, context.storage);
  current = lifecycle.messages;
  // 落盘异步进行,不阻塞主流程;等待写盘完成以保证元信息中的路径可读
  if (lifecycle.persistence) {
    await lifecycle.persistence;
  }

  // ── Layer 3: 上下文窗口检查（异步，极少触发）──
  const calibration = context.calibration && context.calibration > 0 ? context.calibration : 1;
  const rawMsgTokens = await estimateMessagesTokens(current, context.modelName);
  // 用真实 usage 反馈校准估算(见 docs/context-compaction-analysis.md F)
  const msgTokens = Math.ceil(rawMsgTokens * calibration);
  const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);
  const overhead = (context.instructionsTokens ?? 0)
    + (context.toolsTokens ?? 0)
    + getDefaultOutputTokens();
  const totalEstimate = msgTokens + overhead;
  const triggerTokens = Math.floor(contextLimit * config.contextWindow.triggerPercent);

  if (totalEstimate >= triggerTokens) {
    const windowResult = await enforceContextWindow(current, {
      model: context.model,
      fallbackModels: context.fallbackModels,
      modelName: context.modelName,
      conversationId: context.conversationId,
      dataStore: context.dataStore,
      config: config.contextWindow,
      contextLimit: context.contextLimit,
      instructionsTokens: context.instructionsTokens,
      toolsTokens: context.toolsTokens,
    });
    if (windowResult.executed) {
      current = windowResult.messages;
    }
  }

  return current;
}

// ============================================================
// Layer 1: Apply Pending Compactions
// ============================================================

function applyPendingCompactions(messages: PipelineMessage[], ids: string[]): PipelineMessage[] {
  const idSet = new Set(ids);
  return messages.map((msg) => {
    const content = (msg as unknown as Record<string, unknown>).content;
    if (!Array.isArray(content)) return msg;

    let modified = false;
    const newContent = content.map((item: unknown) => {
      const contentItem = item as Record<string, unknown>;
      if (contentItem.type !== 'tool-result') return item;
      const toolCallId = contentItem.toolCallId as string | undefined;
      if (!toolCallId || !idSet.has(toolCallId)) return item;
      if (contentItem._compacted === true) return item;

      const unwrappedResult = unwrapOutput(contentItem.output);
      const summary = extractToolMeta(
        (contentItem.toolName as string) ?? 'unknown',
        null,
        unwrappedResult,
      );
      modified = true;

      return {
        ...contentItem,
        output: { type: 'text', value: summary },
        _compacted: true,
        _originalSize: getToolOutputString(contentItem.output).length,
      };
    });

    if (!modified) return msg;
    return { ...msg, content: newContent } as PipelineMessage;
  });
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
