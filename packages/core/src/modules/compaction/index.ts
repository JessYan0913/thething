// ============================================================
// Compaction Module - Entry Point
// ============================================================
// 源头管理，每步自动替换旧工具输出为结构化元信息
//
// compactBeforeStep 执行顺序：
// 1. Layer 1: 应用 Agent 主动释放的工具输出 (pendingCompactIds)
// 2. Layer 2: 工具输出生命周期管理 (同步，微秒级)
// 3. Layer 3: 上下文窗口检查 (异步，极少触发)

import type { UIMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import type { ToolOutputState } from '../session/interfaces';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageToolOutputLifecycle, extractToolMeta } from './lifecycle';
import { enforceContextWindow } from './context-window';
import { estimateMessagesTokens } from './token-counter';
import { getModelContextLimit, getDefaultOutputTokens } from '../../services/model';
import type { CompactedToolResult } from './types';

// ============================================================
// Main Entry Point: compactBeforeStep
// ============================================================

/**
 * prepareStep 中调用：每步 API 调用前的上下文管理
 */
export async function compactBeforeStep(
  messages: UIMessage[],
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
  },
): Promise<UIMessage[]> {
  let current = messages;

  // ── Layer 1: 应用 Agent 主动释放 ──
  if (toolOutputState.pendingCompactIds && toolOutputState.pendingCompactIds.length > 0) {
    current = applyPendingCompactions(current, toolOutputState.pendingCompactIds);
    toolOutputState.pendingCompactIds = [];
  }

  // ── Layer 2: 工具输出生命周期管理（同步，微秒级）──
  const lifecycle = manageToolOutputLifecycle(current, config.lifecycle);
  current = lifecycle.messages;

  // ── Layer 3: 上下文窗口检查（异步，极少触发）──
  const msgTokens = await estimateMessagesTokens(current, context.modelName);
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

function applyPendingCompactions(messages: UIMessage[], ids: string[]): UIMessage[] {
  const idSet = new Set(ids);
  return messages.map((msg) => {
    if (!msg.parts?.some((p) => p.type === 'dynamic-tool')) return msg;

    const newParts = msg.parts.map((p) => {
      if (p.type !== 'dynamic-tool') return p;

      const part = p as Record<string, unknown>;
      const toolCallId = part.toolCallId as string | undefined;
      if (!toolCallId || !idSet.has(toolCallId)) return p;

      const output = part.output;
      if (!output) return p;
      if (typeof output === 'object' && (output as CompactedToolResult)._compacted) return p;

      const toolName = (part.toolName ?? part.name) as string ?? 'unknown';
      const args = part.input ?? part.args;
      const summary = extractToolMeta(toolName, args, output);
      const originalSize = JSON.stringify(output).length;

      return {
        ...part,
        output: {
          summary,
          _compacted: true,
          _originalSize: originalSize,
        },
      } as typeof p;
    });

    return { ...msg, parts: newParts };
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
