// ============================================================
// Compaction - Reactive Retry (API Error Handling)
// ============================================================
// 当 API 调用因 context-length 错误失败时，尝试恢复


import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import type { Tool } from 'ai';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';
import { manageToolOutputLifecycle } from './lifecycle';
import { estimateRequestBudget } from './request-budget';
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

/** 重试时的跨消息工具输出总额预算（比默认 100k 收紧至 30k） */
const RETRY_MESSAGE_BUDGET = 30_000;

export async function handleReactiveRetry(
  error: unknown,
  messages: import('ai').ModelMessage[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    conversationId: string;
    dataStore: DataStore;
    contextLimit?: number;
    /** 用于诊断分解的完整请求构成（可选，缺省时诊断只含消息侧） */
    instructions?: string;
    tools?: Record<string, Tool>;
  },
): Promise<{ messages: import('ai').ModelMessage[] }> {
  if (!isContextLengthError(error)) throw error;

  logger.warn('ReactiveRetry', 'Context length error detected, attempting recovery');

  // 1. 分配器缩预算重跑:messageBudget 收紧到 30k,强制降级更多 value。
  //    不再下压 keepRecentSteps--key/value 不变式保证 key(工具调用输入)永不被驱逐,
  //    只压 value(输出),模型不会失明。
  let current = manageToolOutputLifecycle(messages, {
    ...config.lifecycle,
    messageBudget: RETRY_MESSAGE_BUDGET,
  }).messages;

  // 2. 同步 LLM 摘要路径已删除——濒死时刻是最差的调 LLM 时机。
  //    改为 Layer 2 激进压缩后若仍超限,直接抛出带估算分解的诊断错误
  //    (见 compaction-redesign.md 4.6 / P2-2)——不再发必然失败的请求。
  const est = await estimateRequestBudget(
    current,
    context.instructions ?? '',
    context.tools ?? {},
    context.modelName,
    context.contextLimit,
  );
  if (est.exceedsLimit) {
    const breakdown =
      `msgs=${est.messagesTokens}` +
      (context.instructions !== undefined ? `+inst=${est.instructionsTokens}` : '') +
      (context.tools !== undefined ? `+tools=${est.toolsTokens}` : '') +
      `+out=${est.outputReserve} = ${est.totalTokens} > ${est.modelLimit}` +
      (context.contextLimit ? ` (configured limit=${context.contextLimit})` : '');
    throw new Error(
      `CONTEXT_BUDGET_EXCEEDED: 激进压缩后仍超限(${breakdown}) | ` +
      `本地估算=${est.totalTokens}, 模型窗口=${est.modelLimit}, ` +
      `calibration=${est.tokenizerBuffer > 0 ? `+${est.tokenizerBuffer}` : 0}`,
    );
  }

  return { messages: current };
}
