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
import type { DataStore } from '../../foundation/datastore/types';
import type { SessionState } from '../session-state/types';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageToolOutputLifecycle, extractToolMeta } from './lifecycle';
import { enforceContextWindow } from './context-window';
import { estimateFullRequest } from './token-counter';
import { getModelContextLimit } from '../../foundation/model';
import type { CompactedToolResult } from './types';

// ============================================================
// Main Entry Point: compactBeforeStep
// ============================================================

/**
 * prepareStep 中调用：每步 API 调用前的上下文管理
 */
export async function compactBeforeStep(
  messages: UIMessage[],
  sessionState: SessionState,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    conversationId: string;
    dataStore: DataStore;
    instructionsTokens?: number;
    toolsTokens?: number;
  },
): Promise<UIMessage[]> {
  let current = messages;

  // ── Layer 1: 应用 Agent 主动释放 ──
  if (sessionState.pendingCompactIds && sessionState.pendingCompactIds.length > 0) {
    current = applyPendingCompactions(current, sessionState.pendingCompactIds);
    sessionState.pendingCompactIds = [];
  }

  // ── Layer 2: 工具输出生命周期管理（同步，微秒级）──
  const lifecycle = manageToolOutputLifecycle(current, config.lifecycle);
  current = lifecycle.messages;

  // ── Layer 3: 上下文窗口检查（异步，极少触发）──
  const estimation = await estimateFullRequest(current, '', {}, context.modelName);
  const contextLimit = getModelContextLimit(context.modelName);
  const triggerTokens = Math.floor(contextLimit * config.contextWindow.triggerPercent);

  if (estimation.messagesTokens >= triggerTokens) {
    const windowResult = await enforceContextWindow(current, {
      model: context.model,
      fallbackModels: context.fallbackModels,
      modelName: context.modelName,
      conversationId: context.conversationId,
      dataStore: context.dataStore,
      config: config.contextWindow,
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
// Re-exports
// ============================================================

export { manageToolOutputLifecycle, extractToolMeta } from './lifecycle';
export { enforceContextWindow } from './context-window';
export { checkInitialBudget, type InitialBudgetCheckResult } from './budget-check';
export { handleReactiveRetry, isContextLengthError } from './retry';
export {
  type CompactionConfig,
  type LifecycleConfig,
  type ContextWindowConfig,
  type CompactedToolResult,
  type CompactionResult,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_LIFECYCLE_CONFIG,
  DEFAULT_CONTEXT_WINDOW_CONFIG,
} from './types';

// ============================================================
// Token Counter (kept, used by external code)
// ============================================================

export {
  estimateMessagesTokens,
  estimateToolTokens,
  estimateToolsTokens,
  estimateInstructionsTokens,
  estimateFullRequest,
  preloadTokenizer,
  setTokenizerDir,
  formatEstimationResult,
  type FullRequestEstimation,
} from './token-counter';

export {
  registerTokenizer,
  setAutoDownload,
} from './tokenizer';

// ============================================================
// Title Generator
// ============================================================

export { generateConversationTitle } from './title-generator';
