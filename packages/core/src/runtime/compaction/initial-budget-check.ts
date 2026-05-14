// ============================================================
// Initial Budget Check - 初始预算检查与降级处理
// ============================================================
// 在第一次 API 调用前检查完整请求的 Token 预算
// 参考 ClaudeCode 的预算管理机制

import type { UIMessage, Tool } from 'ai';
import type { DataStore } from '../../foundation/datastore/types';
import {
  estimateFullRequest,
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateToolsTokens,
  estimateToolTokens,
  type FullRequestEstimation,
} from './token-counter';
import { getEffectiveContextBudget, getModelContextLimit } from '../../foundation/model';
import { microCompactMessages } from './micro-compact';
import { compactMessagesIfNeeded, type CompactOptions } from './index';
import { tryPtlDegradation } from './ptl-degradation';

// ============================================================
// 常量配置
// ============================================================

/** 核心工具白名单（不可移除） */
const CORE_TOOLS = new Set([
  'bash',
  'read_file',
  'write_file',
  'edit_file',
  'grep',
  'glob',
]);

/** 可选工具优先级（按重要性降序，超出预算时按此顺序移除） */
const OPTIONAL_TOOL_PRIORITY = [
  // 最先移除：MCP 和 Connector 工具
  'mcp_*',
  'connector_*',
  // 其次：网络和研究
  'web_search',
  'research',
  // 最后：任务和用户交互
  'task_*',
  'ask_user_question',
];

/** 工具预算占比限制 */
const TOOL_BUDGET_RATIO = 0.10;  // 工具最多占用 10% 上下文

/** 消息预算占比限制 */
const MESSAGE_BUDGET_RATIO = 0.50;  // 消息最多占用 50% 上下文

// ============================================================
// 类型定义
// ============================================================

export interface InitialBudgetCheckResult {
  /** 是否通过预算检查 */
  passed: boolean;
  /** Token 估算详情 */
  estimation: FullRequestEstimation;
  /** 执行的降级动作列表 */
  actions: string[];
  /** 调整后的工具集 */
  adjustedTools?: Record<string, Tool>;
  /** 调整后的消息 */
  adjustedMessages?: UIMessage[];
}

// ============================================================
// 主函数：初始预算检查
// ============================================================

/**
 * 初始预算检查
 * 在第一次 API 调用前执行，确保请求不超出模型上下文限制
 *
 * 降级策略（按优先级执行）：
 * 1. MicroCompact - 清除旧的工具输出
 * 2. 工具过滤 - 移除低优先级工具（MCP/Connector）
 * 3. API Compact - LLM 压缩消息
 * 4. 紧急截断 - 丢弃最早的消息
 */
export async function checkInitialBudget(
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string,
  dataStore: DataStore,
  conversationId?: string,
  compactOptions?: CompactOptions,
): Promise<InitialBudgetCheckResult> {
  // 第一次估算（使用异步精确估算）
  const initialEstimation = await estimateFullRequest(messages, instructions, tools, modelName);
  const actions: string[] = [];

  // 记录初始状态
  console.log(`[Initial Budget] Model: ${modelName}, Limit: ${initialEstimation.modelLimit}`);
  console.log(`[Initial Budget] Initial estimate: ${initialEstimation.totalTokens} tokens (${initialEstimation.utilizationPercent.toFixed(1)}%)`);

  // 如果未超出限制，直接返回
  if (!initialEstimation.exceedsLimit) {
    return {
      passed: true,
      estimation: initialEstimation,
      actions: ['Budget check passed'],
    };
  }

  console.warn(
    `[Initial Budget] ⚠️ Exceeds limit: ${initialEstimation.totalTokens} > ${initialEstimation.modelLimit}`
  );

  // 开始降级处理
  let currentMessages = messages;
  let currentTools = tools;
  let currentEstimation = initialEstimation;
  const compactionEnabled = compactOptions?.enabled !== false;

  // ============================================================
  // 策略 1: MicroCompact - 清除旧工具输出
  // ============================================================
  if (compactionEnabled && currentEstimation.messagesTokens > currentEstimation.modelLimit * 0.2) {
    const microResult = await microCompactMessages(currentMessages);
    if (microResult.executed && microResult.tokensFreed > 500) {
      currentMessages = microResult.messages;
      actions.push(`MicroCompact: freed ${microResult.tokensFreed} tokens`);

      currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);
      console.log(`[Initial Budget] After MicroCompact: ${currentEstimation.totalTokens} tokens`);

      if (!currentEstimation.exceedsLimit) {
        return {
          passed: true,
          estimation: currentEstimation,
          actions,
          adjustedMessages: currentMessages,
        };
      }
    }
  }

  // ============================================================
  // 策略 2: 工具过滤 - 移除低优先级工具
  // ============================================================
  if (currentEstimation.toolsTokens > currentEstimation.modelLimit * TOOL_BUDGET_RATIO) {
    const filteredTools = await filterToolsByPriority(currentTools, currentEstimation);
    const removedCount = Object.keys(currentTools).length - Object.keys(filteredTools).length;

    if (removedCount > 0) {
      currentTools = filteredTools;
      actions.push(`Tool filter: removed ${removedCount} optional tools`);

      currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);
      console.log(`[Initial Budget] After tool filter: ${currentEstimation.totalTokens} tokens (${Object.keys(currentTools).length} tools)`);

      if (!currentEstimation.exceedsLimit) {
        return {
          passed: true,
          estimation: currentEstimation,
          actions,
          adjustedTools: currentTools,
          adjustedMessages: currentMessages,
        };
      }
    }
  }

  // ============================================================
  // 策略 3: API Compact - LLM 压缩消息（仅在有 conversationId 时）
  // ============================================================
  if (compactionEnabled && conversationId && currentEstimation.messagesTokens > currentEstimation.modelLimit * 0.3) {
    try {
      const compactResult = await compactMessagesIfNeeded(
        currentMessages,
        conversationId,
        dataStore,
        compactOptions,
      );
      if (compactResult.executed && compactResult.tokensFreed > 1000) {
        currentMessages = compactResult.messages;
        actions.push(`API Compact: freed ${compactResult.tokensFreed} tokens`);

        currentEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);
        console.log(`[Initial Budget] After API Compact: ${currentEstimation.totalTokens} tokens`);

        if (!currentEstimation.exceedsLimit) {
          return {
            passed: true,
            estimation: currentEstimation,
            actions,
            adjustedTools: currentTools,
            adjustedMessages: currentMessages,
          };
        }
      }
    } catch (error) {
      console.warn('[Initial Budget] API Compact failed:', error);
    }
  }

  // ============================================================
  // 策略 4: 紧急截断 - 直接丢弃最早的消息
  // ============================================================
  const targetMessagesBudget = currentEstimation.modelLimit * MESSAGE_BUDGET_RATIO;
  const currentMessagesTokens = await estimateMessagesTokens(currentMessages);

  if (currentMessagesTokens > targetMessagesBudget) {
    const truncateResult = await truncateMessagesToBudget(
      currentMessages,
      targetMessagesBudget,
      currentEstimation.instructionsTokens + currentEstimation.toolsTokens + currentEstimation.outputReserve
    );

    if (truncateResult.messagesRemoved > 0) {
      currentMessages = truncateResult.messages;
      actions.push(`Emergency truncate: removed ${truncateResult.messagesRemoved} messages (~${truncateResult.tokensFreed} tokens)`);
    }
  }

  // 最终估算
  const finalEstimation = await estimateFullRequest(currentMessages, instructions, currentTools, modelName);

  console.log(
    `[Initial Budget] Final: ${finalEstimation.totalTokens} tokens ` +
    `(${finalEstimation.utilizationPercent.toFixed(1)}%) - ` +
    `${finalEstimation.exceedsLimit ? '❌ STILL EXCEEDS' : '✅ OK'}`
  );

  return {
    passed: !finalEstimation.exceedsLimit,
    estimation: finalEstimation,
    actions,
    adjustedTools: currentTools,
    adjustedMessages: currentMessages,
  };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 按优先级过滤工具
 * 保留核心工具，按优先级移除可选工具
 */
async function filterToolsByPriority(
  tools: Record<string, Tool>,
  estimation: FullRequestEstimation
): Promise<Record<string, Tool>> {
  const result: Record<string, Tool> = {};
  const targetToolTokens = estimation.modelLimit * TOOL_BUDGET_RATIO;

  // 1. 先保留所有核心工具
  for (const [name, tool] of Object.entries(tools)) {
    if (CORE_TOOLS.has(name)) {
      result[name] = tool;
    }
  }

  let currentTokens = await estimateToolsTokens(result);

  // 2. 按优先级添加可选工具（直到达到预算）
  for (const pattern of OPTIONAL_TOOL_PRIORITY) {
    for (const [name, tool] of Object.entries(tools)) {
      if (result[name]) continue;  // 已添加
      if (CORE_TOOLS.has(name)) continue;  // 核心工具已处理

      // 匹配模式（支持 * 通配符）
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

  // 3. 添加剩余工具（如果还有预算）
  for (const [name, tool] of Object.entries(tools)) {
    if (result[name]) continue;
    if (CORE_TOOLS.has(name)) continue;

    const toolTokens = await estimateToolTokens(tool);
    if (currentTokens + toolTokens < targetToolTokens) {
      result[name] = tool;
      currentTokens += toolTokens;
    }
  }

  return result;
}

/**
 * 紧急截断消息到预算
 * 从最旧的消息开始移除，保留最近的消息
 */
async function truncateMessagesToBudget(
  messages: UIMessage[],
  targetMessagesBudget: number,
  fixedOverhead: number
): Promise<{ messages: UIMessage[]; messagesRemoved: number; tokensFreed: number }> {
  const modelLimit = getModelContextLimit('default');
  const maxAllowedTokens = modelLimit - fixedOverhead;

  let currentTokens = await estimateMessagesTokens(messages);
  let startIndex = 0;
  let tokensFreed = 0;

  // 从最旧的消息开始移除（保留至少 3 条最新消息）
  while (currentTokens > Math.min(targetMessagesBudget, maxAllowedTokens) &&
         startIndex < messages.length - 3) {
    const removedTokens = await estimateMessageTokens(messages[startIndex]);
    currentTokens -= removedTokens;
    tokensFreed += removedTokens;
    startIndex++;
  }

  const truncated = messages.slice(startIndex);
  return {
    messages: truncated,
    messagesRemoved: startIndex,
    tokensFreed,
  };
}

/**
 * 快速检查是否可能超出预算（不执行降级）
 * 用于提前预警
 */
export async function quickBudgetCheck(
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string
): Promise<{ likelyExceeds: boolean; estimation: FullRequestEstimation }> {
  const estimation = await estimateFullRequest(messages, instructions, tools, modelName);

  // 预留 10% 安全边际
  const safetyMargin = estimation.modelLimit * 0.10;
  const likelyExceeds = estimation.totalTokens > estimation.modelLimit - safetyMargin;

  return { likelyExceeds, estimation };
}
