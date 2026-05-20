// ============================================================
// Compaction - Reactive Retry (API Error Handling)
// ============================================================
// 当 API 调用因 context-length 错误失败时，尝试恢复

import type { UIMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageToolOutputLifecycle } from './lifecycle';
import { enforceContextWindow } from './context-window';
import { logger } from '../../primitives/logger';

// ============================================================
// Error Detection
// ============================================================

export function isContextLengthError(error: unknown): boolean {
  if (!error) return false;

  const errorStr = String(error).toLowerCase();
  const message = (error as { message?: string })?.message?.toLowerCase() ?? '';

  return (
    errorStr.includes('context_length_exceeded') ||
    errorStr.includes('context length') ||
    errorStr.includes('maximum context length') ||
    errorStr.includes('token limit') ||
    errorStr.includes('too many tokens') ||
    message.includes('context_length_exceeded') ||
    message.includes('context length') ||
    message.includes('maximum context length')
  );
}

// ============================================================
// Reactive Retry
// ============================================================

export async function handleReactiveRetry(
  error: unknown,
  messages: UIMessage[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    conversationId: string;
    dataStore: DataStore;
  },
): Promise<{ messages: UIMessage[] }> {
  if (!isContextLengthError(error)) throw error;

  logger.warn('ReactiveRetry', 'Context length error detected, attempting recovery');

  // 1. 激进 Layer 2：keepRecentTurns=1
  let current = manageToolOutputLifecycle(messages, {
    ...config.lifecycle,
    keepRecentTurns: 1,
  }).messages;

  // 2. Layer 3 紧急摘要
  try {
    const windowResult = await enforceContextWindow(current, {
      model: context.model,
      fallbackModels: context.fallbackModels,
      modelName: context.modelName,
      conversationId: context.conversationId,
      dataStore: context.dataStore,
      config: { ...config.contextWindow, targetPercent: 0.50 },
    });
    current = windowResult.messages;
  } catch (err) {
    logger.warn('ReactiveRetry', 'Layer 3 failed:', err);
  }

  return { messages: current };
}
