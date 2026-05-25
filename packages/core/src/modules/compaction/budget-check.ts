// ============================================================
// Compaction - Initial Budget Check
// ============================================================
// 简化版：在第一次 API 调用前检查预算，按优先级降级

import type { UIMessage, Tool } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import { logger } from '../../primitives/logger';
import {
  estimateFullRequest,
  estimateMessagesTokens,
  estimateToolsTokens,
  estimateToolTokens,
  type FullRequestEstimation,
} from './token-counter';
import { getModelContextLimit } from '../../services/model';
import { manageToolOutputLifecycle } from './lifecycle';
import { enforceContextWindow } from './context-window';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';

// ============================================================
// Constants
// ============================================================

const CORE_TOOLS = new Set(['bash', 'read_file', 'write_file', 'edit_file', 'grep', 'glob']);

const OPTIONAL_TOOL_PRIORITY = [
  'mcp_*',
  'connector_*',
  'web_fetch',
  'research',
  'todo_*',
  'ask_user_question',
];

const TOOL_BUDGET_RATIO = 0.10;
const MESSAGE_BUDGET_RATIO = 0.50;

// ============================================================
// Types
// ============================================================

export interface InitialBudgetCheckResult {
  passed: boolean;
  estimation: FullRequestEstimation;
  actions: string[];
  adjustedTools?: Record<string, Tool>;
  adjustedMessages?: UIMessage[];
}

// ============================================================
// Main Function
// ============================================================

export async function checkInitialBudget(
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context?: {
    dataStore?: DataStore;
    conversationId?: string;
    model?: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
  },
): Promise<InitialBudgetCheckResult> {
  const initialEstimation = await estimateFullRequest(messages, instructions, tools, modelName);
  const actions: string[] = [];

  logger.debug('Budget', `Model: ${modelName}, Limit: ${initialEstimation.modelLimit}`);
  logger.debug('Budget', `Initial: ${initialEstimation.totalTokens} tokens (${initialEstimation.utilizationPercent.toFixed(1)}%)`);

  if (!initialEstimation.exceedsLimit) {
    return { passed: true, estimation: initialEstimation, actions: ['Budget check passed'] };
  }

  logger.warn('Budget', `Exceeds limit: ${initialEstimation.totalTokens} > ${initialEstimation.modelLimit}`);

  let currentMessages = messages;
  let currentTools = tools;
  let currentEstimation = initialEstimation;

  // ── Strategy 1: Layer 2 aggressive compression ──
  if (currentEstimation.messagesTokens > currentEstimation.modelLimit * 0.2) {
    const aggressiveConfig = { ...config.lifecycle, keepRecentTurns: 1 };
    const lifecycleResult = manageToolOutputLifecycle(currentMessages, aggressiveConfig);
    if (lifecycleResult.tokensFreed > 0) {
      currentMessages = lifecycleResult.messages;
      actions.push(`Layer 2: freed ${lifecycleResult.tokensFreed} tokens`);

      currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);
      logger.debug('Budget', `After Layer 2: ${currentEstimation.totalTokens} tokens`);

      if (!currentEstimation.exceedsLimit) {
        return { passed: true, estimation: currentEstimation, actions, adjustedMessages: currentMessages };
      }
    }
  }

  // ── Strategy 2: Tool filtering ──
  if (currentEstimation.toolsTokens > currentEstimation.modelLimit * TOOL_BUDGET_RATIO) {
    const filtered = await filterToolsByPriority(currentTools, currentEstimation);
    const removed = Object.keys(currentTools).length - Object.keys(filtered).length;
    if (removed > 0) {
      currentTools = filtered;
      actions.push(`Tool filter: removed ${removed} tools`);

      currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);
      logger.debug('Budget', `After tool filter: ${currentEstimation.totalTokens} tokens`);

      if (!currentEstimation.exceedsLimit) {
        return { passed: true, estimation: currentEstimation, actions, adjustedTools: currentTools, adjustedMessages: currentMessages };
      }
    }
  }

  // ── Strategy 3: Layer 3 LLM summary ──
  if (context?.conversationId && context?.model && currentEstimation.messagesTokens > currentEstimation.modelLimit * 0.3) {
    try {
      const windowResult = await enforceContextWindow(currentMessages, {
        model: context.model,
        fallbackModels: context.fallbackModels,
        modelName,
        conversationId: context.conversationId,
        dataStore: context.dataStore!,
        config: config.contextWindow,
      });
      if (windowResult.executed) {
        currentMessages = windowResult.messages;
        actions.push(`Layer 3: freed ${windowResult.tokensFreed} tokens`);

        currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);
        logger.debug('Budget', `After Layer 3: ${currentEstimation.totalTokens} tokens`);

        if (!currentEstimation.exceedsLimit) {
          return { passed: true, estimation: currentEstimation, actions, adjustedTools: currentTools, adjustedMessages: currentMessages };
        }
      }
    } catch (err) {
      logger.warn('Budget', 'Layer 3 failed:', err);
    }
  }

  // ── Strategy 4: Emergency truncation ──
  const targetMessagesBudget = currentEstimation.modelLimit * MESSAGE_BUDGET_RATIO;
  const currentMessagesTokens = await estimateMessagesTokens(currentMessages);

  if (currentMessagesTokens > targetMessagesBudget) {
    const truncated = truncateFromHead(currentMessages, targetMessagesBudget, currentEstimation);
    if (truncated.removed > 0) {
      currentMessages = truncated.messages;
      actions.push(`Emergency truncate: removed ${truncated.removed} messages`);
    }
  }

  const finalEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);
  logger.debug('Budget', `Final: ${finalEstimation.totalTokens} tokens (${finalEstimation.utilizationPercent.toFixed(1)}%) - ${finalEstimation.exceedsLimit ? 'EXCEEDS' : 'OK'}`);

  return {
    passed: !finalEstimation.exceedsLimit,
    estimation: finalEstimation,
    actions,
    adjustedTools: currentTools,
    adjustedMessages: currentMessages,
  };
}

// ============================================================
// Tool Filtering
// ============================================================

async function filterToolsByPriority(
  tools: Record<string, Tool>,
  estimation: FullRequestEstimation,
): Promise<Record<string, Tool>> {
  const result: Record<string, Tool> = {};
  const targetToolTokens = estimation.modelLimit * TOOL_BUDGET_RATIO;

  // 1. 保留核心工具
  for (const [name, tool] of Object.entries(tools)) {
    if (CORE_TOOLS.has(name)) {
      result[name] = tool;
    }
  }

  let currentTokens = await estimateToolsTokens(result);

  // 2. 按优先级添加可选工具
  for (const pattern of OPTIONAL_TOOL_PRIORITY) {
    for (const [name, tool] of Object.entries(tools)) {
      if (result[name] || CORE_TOOLS.has(name)) continue;

      const matches = pattern.endsWith('*')
        ? name.startsWith(pattern.slice(0, -1))
        : name === pattern;

      if (matches) {
        const toolTokens = await estimateToolTokens(tool);
        if (currentTokens + toolTokens < targetToolTokens) {
          result[name] = tool;
          currentTokens += toolTokens;
        }
      }
    }
  }

  // 3. 添加剩余工具
  for (const [name, tool] of Object.entries(tools)) {
    if (result[name] || CORE_TOOLS.has(name)) continue;
    const toolTokens = await estimateToolTokens(tool);
    if (currentTokens + toolTokens < targetToolTokens) {
      result[name] = tool;
      currentTokens += toolTokens;
    }
  }

  return result;
}

// ============================================================
// Emergency Truncation (simplified, no preserveToolPairs)
// ============================================================

function truncateFromHead(
  messages: UIMessage[],
  targetMessageTokens: number,
  estimation: FullRequestEstimation,
): { messages: UIMessage[]; removed: number } {
  // 同步估算（如果 tokenizer 已加载）
  let tokens = estimation.messagesTokens;
  let startIndex = 0;

  // 从头部移除消息，保留至少 3 条
  while (tokens > targetMessageTokens && startIndex < messages.length - 3) {
    // 粗略估算每条消息的 token（使用平均值）
    const avgTokens = tokens / (messages.length - startIndex);
    tokens -= avgTokens;
    startIndex++;
  }

  // 对齐到用户消息边界
  while (startIndex < messages.length - 3) {
    const msg = messages[startIndex];
    if (msg.role === 'user') break;
    startIndex++;
  }

  return {
    messages: messages.slice(startIndex),
    removed: startIndex,
  };
}
