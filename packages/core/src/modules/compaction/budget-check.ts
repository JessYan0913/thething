// 简化版闸门：Agent 创建前检查预算，按优先级降级
// 见 docs/context-invariant-architecture.md S6

import type { Tool } from 'ai';

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import { logger } from '../../primitives/logger';
import { estimateFullRequest, estimateToolsTokens, estimateToolTokens, type FullRequestEstimation } from './token-counter';
import { manageToolOutputLifecycle } from './lifecycle';
import { applyEmergencyCompression } from './index';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from './types';

const CORE_TOOLS = new Set(['bash', 'read_file', 'write_file', 'edit_file', 'grep', 'glob']);
const OPTIONAL_TOOL_PRIORITY = ['mcp_*', 'connector_*', 'web_fetch', 'research', 'todo_*', 'ask_user_question'];
const TOOL_BUDGET_RATIO = 0.10;

export interface InitialBudgetCheckResult {
  passed: boolean;
  estimation: FullRequestEstimation;
  actions: string[];
  adjustedTools?: Record<string, Tool>;
  adjustedMessages?: import('ai').ModelMessage[];
}

export async function checkInitialBudget(
  messages: import('ai').ModelMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  context?: {
    dataStore?: DataStore;
    conversationId?: string;
    model?: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    contextLimit?: number;
  },
): Promise<InitialBudgetCheckResult> {
  const contextLimit = context?.contextLimit;
  const initialEstimation = await estimateFullRequest(messages, instructions, tools, modelName, contextLimit);
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

  // Strategy 1: Layer 2 激进压缩
  if (currentEstimation.messagesTokens > currentEstimation.modelLimit * 0.2) {
    const aggressiveConfig = { ...config.lifecycle, keepRecentSteps: 1 };
    const lifecycleResult = manageToolOutputLifecycle(currentMessages, aggressiveConfig);
    if (lifecycleResult.tokensFreed > 0) {
      currentMessages = lifecycleResult.messages;
      actions.push(`Layer 2: freed ${lifecycleResult.tokensFreed} tokens`);
      currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName, contextLimit);
      logger.debug('Budget', `After Layer 2: ${currentEstimation.totalTokens} tokens`);
      if (!currentEstimation.exceedsLimit) {
        return { passed: true, estimation: currentEstimation, actions, adjustedMessages: currentMessages };
      }
    }
  }

  // Strategy 1.5: Emergency compression (Layer 2.5 → 3 → truncation)
  // 如果 Layer 2 后仍超限且有 model 可用，应用完整紧急压缩管线
  if (currentEstimation.exceedsLimit && context?.model) {
    logger.info('Budget', `Layer 2 后仍超限，启动紧急压缩管线`);
    try {
      currentMessages = await applyEmergencyCompression(currentMessages, {
        model: context.model,
        fallbackModels: context.fallbackModels,
        modelName,
        contextLimit,
        tools: currentTools,
        instructions,
        targetTokens: currentEstimation.modelLimit * 0.8,
      });
      actions.push(`Emergency compression applied (Layer 2.5→3→truncation)`);
      currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName, contextLimit);
      logger.debug('Budget', `After emergency compression: ${currentEstimation.totalTokens} tokens`);
      if (!currentEstimation.exceedsLimit) {
        return { passed: true, estimation: currentEstimation, actions, adjustedMessages: currentMessages };
      }
    } catch (err) {
      logger.warn('Budget', 'Emergency compression failed:', err);
      actions.push(`Emergency compression failed: ${err}`);
    }
  }

  // Strategy 2: 工具过滤
  if (currentEstimation.toolsTokens > currentEstimation.modelLimit * TOOL_BUDGET_RATIO) {
    const filtered = await filterToolsByPriority(currentTools, currentEstimation);
    const removed = Object.keys(currentTools).length - Object.keys(filtered).length;
    if (removed > 0) {
      currentTools = filtered;
      actions.push(`Tool filter: removed ${removed} tools`);
      currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName, contextLimit);
      logger.debug('Budget', `After tool filter: ${currentEstimation.totalTokens} tokens`);
      if (!currentEstimation.exceedsLimit) {
        return { passed: true, estimation: currentEstimation, actions, adjustedTools: currentTools, adjustedMessages: currentMessages };
      }
    }
  }

  // Strategy 3: 最激进模式 - 只保留核心工具 + 最小消息集
  if (currentEstimation.exceedsLimit) {
    logger.warn('Budget', '常规策略均失败，启动最激进模式：只保留核心工具 + 最小消息');

    // 只保留最核心的工具
    const minimalTools: Record<string, Tool> = {};
    for (const name of ['read_file', 'write_file', 'bash']) {
      if (currentTools[name]) {
        minimalTools[name] = currentTools[name];
      }
    }

    // 强制截断消息到极限
    const { forceTruncateMessages } = await import('./message-compressor');
    const targetMessagesTokens = Math.floor(currentEstimation.modelLimit * 0.3); // 只给 messages 30% 的预算
    currentMessages = await forceTruncateMessages(
      currentMessages,
      0.05, // 只保留 5%
      modelName,
      targetMessagesTokens,
    );

    currentTools = minimalTools;
    actions.push(`Extreme mode: core tools only + minimal messages`);

    currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName, contextLimit);
    logger.debug('Budget', `After extreme mode: ${currentEstimation.totalTokens} tokens`);

    if (!currentEstimation.exceedsLimit) {
      return { passed: true, estimation: currentEstimation, actions, adjustedTools: currentTools, adjustedMessages: currentMessages };
    }
  }

  // 所有策略已用尽
  const finalEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName, contextLimit);
  logger.debug('Budget', `Final: ${finalEstimation.totalTokens} tokens (${finalEstimation.utilizationPercent.toFixed(1)}%) - ${finalEstimation.exceedsLimit ? 'EXCEEDS' : 'OK'}`);

  return {
    passed: !finalEstimation.exceedsLimit,
    estimation: finalEstimation,
    actions,
    adjustedTools: currentTools,
    adjustedMessages: currentMessages,
  };
}

async function filterToolsByPriority(tools: Record<string, Tool>, estimation: FullRequestEstimation): Promise<Record<string, Tool>> {
  const result: Record<string, Tool> = {};
  const targetToolTokens = estimation.modelLimit * TOOL_BUDGET_RATIO;

  // 1. 保留核心工具
  for (const [name, tool] of Object.entries(tools)) {
    if (CORE_TOOLS.has(name)) result[name] = tool;
  }

  let currentTokens = await estimateToolsTokens(result);

  // 2. 按优先级添加可选工具
  for (const pattern of OPTIONAL_TOOL_PRIORITY) {
    for (const [name, tool] of Object.entries(tools)) {
      if (result[name] || CORE_TOOLS.has(name)) continue;
      const matches = pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
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
    if (!result[name] && !CORE_TOOLS.has(name)) {
      const toolTokens = await estimateToolTokens(tool);
      if (currentTokens + toolTokens < targetToolTokens) {
        result[name] = tool;
        currentTokens += toolTokens;
      }
    }
  }

  return result;
}