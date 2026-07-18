// ============================================================
// Compaction - Layer 3: Context Window Management
// ============================================================
// 当 Layer 2 不够时（纯文本对话增长、大量小工具调用累积），
// 用 LLM 生成摘要。极少触发。

import { generateText, type UIMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import { type ContextWindowConfig, DEFAULT_CONTEXT_WINDOW_CONFIG } from './types';
import { logger } from '../../primitives/logger';
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  extractMessageText,
  stripImagesFromMessages,
} from './token-counter';
import { getModelContextLimit, getDefaultOutputTokens } from '../../services/model';

// ============================================================
// Summary Prompt
// ============================================================

const SUMMARY_SYSTEM_PROMPT = `你是一个对话摘要助手。请用简洁的语言总结对话，捕捉关键信息和价值。

核心要求：
1. 长度：200-500字
2. 视角：第三人称客观记录（"用户询问了X，助手回答了Y，随后讨论深入到Z"）
3. 内容平衡：既要记录用户的问题，也要记录助手的关键回复和结论

必须包含的要素：
- 用户的核心问题是什么
- 助手提供了什么关键信息或建议
- 对话如何演进（从A话题转到B话题）
- 最终讨论的焦点是什么

增量摘要处理：
- 如果输入包含【历史摘要】和【新增对话】，请整合两者
- 保留历史摘要的核心信息，补充新对话的关键内容
- 用"随后"、"接着"、"进一步"等词衔接历史和新内容
- 确保整体摘要连贯、完整，体现对话的完整演进过程

避免的错误：
❌ 只列出用户的提问，不记录助手的回复
❌ 复制粘贴大段原文、代码、搜索结果
❌ 用"这是一个很好的问题"等空话
❌ 增量摘要时丢弃历史内容，只总结新对话

请直接输出摘要，不要任何前缀或解释。`;

const MAX_SUMMARY_LENGTH = 3000;

// ============================================================
// Main Function
// ============================================================

export async function enforceContextWindow(
  messages: UIMessage[],
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    conversationId: string;
    dataStore: DataStore;
    config: ContextWindowConfig;
    contextLimit?: number;
    instructionsTokens?: number;
    toolsTokens?: number;
  },
): Promise<{ messages: UIMessage[]; executed: boolean; tokensFreed: number }> {
  const config = context.config ?? DEFAULT_CONTEXT_WINDOW_CONFIG;

  const msgTokens = await estimateMessagesTokens(messages, context.modelName);
  const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);
  const realInstructions = context.instructionsTokens ?? 0;
  const realTools = context.toolsTokens ?? 0;
  const outputReserve = getDefaultOutputTokens();
  const overhead = realInstructions + realTools + outputReserve;
  const totalEstimate = msgTokens + overhead;
  const triggerTokens = Math.floor(contextLimit * config.triggerPercent);

  if (totalEstimate < triggerTokens) {
    return { messages, executed: false, tokensFreed: 0 };
  }

  const targetTokens = Math.floor(contextLimit * config.targetPercent);
  const MIN_MESSAGE_BUDGET_TOKENS = 2000;
  const rawBudget = targetTokens - overhead;
  const targetMessageTokens = Math.max(MIN_MESSAGE_BUDGET_TOKENS, rawBudget);

  if (rawBudget < MIN_MESSAGE_BUDGET_TOKENS) {
    logger.warn('ContextWindow', `contextLimit ${contextLimit} too small for overhead `
      + `(instructions=${realInstructions}, tools=${realTools}, output=${outputReserve}), `
      + `message budget forced to minimum ${MIN_MESSAGE_BUDGET_TOKENS}`);
  }

  // 找到分割点：保留后段 token 数 ≈ targetMessageTokens
  const splitIndex = await findSplitIndex(messages, targetMessageTokens, context.modelName);

  if (splitIndex < 3) {
    return { messages, executed: false, tokensFreed: 0 };
  }

  const olderMessages = messages.slice(0, splitIndex);
  const newerMessages = messages.slice(splitIndex);

  // 生成摘要
  const summary = await generateSummaryWithFallback(
    olderMessages, context.model, context.fallbackModels,
    context.conversationId, context.dataStore, config,
  );

  const summaryMessage: UIMessage = {
    id: `summary-${Date.now()}`,
    role: 'user',
    // 流水线传递的是 ModelMessage (.content) 而非 UIMessage (.parts)。
    // 用 .content 格式,避免 summaryMessage 在发给模型时被序列化为空消息。
    // 见 docs/context-compaction-analysis.md #4。
    content: [{
      type: 'text',
      text: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n${summary}`,
    }],
  } as unknown as UIMessage;

  const result = [summaryMessage, ...newerMessages];

  const newMsgTokens = await estimateMessagesTokens(result, context.modelName);
  const tokensFreed = Math.max(0, msgTokens - newMsgTokens);

  return { messages: result, executed: true, tokensFreed };
}

// ============================================================
// Summary Generation
// ============================================================

async function generateSummaryWithFallback(
  messages: UIMessage[],
  model: LanguageModelV3,
  fallbackModels: LanguageModelV3[] | undefined,
  conversationId: string,
  dataStore: DataStore,
  config: ContextWindowConfig,
): Promise<string> {
  // 1. 构建摘要输入
  const stripped = stripImagesFromMessages(messages);
  const conversationText = stripped.map((m) => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    return `${role}: ${extractMessageText(m)}`;
  }).join('\n\n');

  // 2. 增量摘要：如果 DB 有已存摘要，在其基础上追加
  let prompt: string;
  if (config.incrementalSummary) {
    const existing = getExistingSummarySafe(conversationId, dataStore);
    if (existing) {
      prompt = `【历史摘要】\n${existing}\n\n【新增对话】\n${conversationText}`;
    } else {
      prompt = conversationText;
    }
  } else {
    prompt = conversationText;
  }

  // 3. 调用 LLM 生成摘要（主模型 + fallback）
  const summary = await callWithFallback(prompt, model, fallbackModels);

  // 4. 质量验证
  if (summary && validateSummaryQuality(summary, messages)) {
    saveSummarySafe(conversationId, summary, messages.length - 1, 0, dataStore);
    return summary;
  }

  // 5. LLM 失败 → 模板 fallback
  return generateTemplateSummary(messages);
}

async function callWithFallback(
  prompt: string,
  model: LanguageModelV3,
  fallbackModels?: LanguageModelV3[],
): Promise<string | null> {
  // 主模型尝试 2 次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await generateText({
        model,
        instructions: SUMMARY_SYSTEM_PROMPT,
        prompt,
        maxOutputTokens: 2000,
      });
      if (text?.trim()) return text.trim();
    } catch (err) {
      logger.warn('ContextWindow', `Summary attempt ${attempt + 1} failed:`, err);
      if (attempt === 0) await delay(2000);
    }
  }
  // fallback 模型各 1 次
  for (const fb of fallbackModels ?? []) {
    try {
      const { text } = await generateText({
        model: fb,
        instructions: SUMMARY_SYSTEM_PROMPT,
        prompt,
        maxOutputTokens: 2000,
      });
      if (text?.trim()) return text.trim();
    } catch {
      // ignore
    }
  }
  return null;
}

// ============================================================
// Quality Validation & Template Fallback
// ============================================================

/**
 * 验证摘要质量 - 语言无关的验证逻辑
 * 见 docs/context-compaction-analysis.md #3
 * （导出仅用于测试）
 */
export function validateSummaryQuality(summary: string, messages: UIMessage[]): boolean {
  // 基本长度检查：太短或太长都不可用
  if (!summary || summary.length < 20) return false;
  if (summary.length > MAX_SUMMARY_LENGTH) {
    logger.warn('ContextWindow', `Summary too long (${summary.length} chars), likely copying content`);
    return false;
  }

  // 提取所有对话文本用于对比
  const allText = messages
    .map((m) => extractMessageText(m))
    .join('\n')
    .trim();

  if (!allText) return true; // 没有原文可对比，接受摘要

  // 非复制检测：摘要不应是原文的简单复制
  // 计算最长公共子串（LCS）长度占比
  const lcsLength = longestCommonSubstringLength(summary, allText);
  const lcsRatio = lcsLength / summary.length;

  // 如果超过 60% 的内容是原文的连续复制，认为是复制而非摘要
  if (lcsRatio > 0.6) {
    logger.warn('ContextWindow', `Summary appears to be copied from original (${(lcsRatio * 100).toFixed(1)}% LCS ratio)`);
    return false;
  }

  return true;
}

/**
 * 计算两个字符串的最长公共子串长度
 * 用于检测摘要是否是原文的简单复制
 */
function longestCommonSubstringLength(s1: string, s2: string): number {
  // 对超长文本进行截断，避免 O(n²) 复杂度问题
  const maxLen = 1000;
  const a = s1.slice(0, maxLen);
  const b = s2.slice(0, maxLen * 5); // 原文可能很长

  let maxLength = 0;
  const matrix: number[][] = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(0));

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
        maxLength = Math.max(maxLength, matrix[i][j]);
      }
    }
  }

  return maxLength;
}

function generateTemplateSummary(messages: UIMessage[]): string {
  const userMessages = messages.filter((m) => m.role === 'user');

  const recentPairs: string[] = [];
  for (let i = Math.max(0, messages.length - 10); i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const userText = extractMessageText(msg).substring(0, 150);
      const nextAssistant = messages.slice(i + 1).find((m) => m.role === 'assistant');
      if (nextAssistant) {
        const assistantText = extractMessageText(nextAssistant).substring(0, 200);
        recentPairs.push(`用户询问${userText}，助手回复${assistantText}`);
      } else {
        recentPairs.push(`用户询问${userText}`);
      }
    }
  }

  if (recentPairs.length > 0) {
    return recentPairs.slice(-3).join('。') + '。';
  }

  const topicHints = userMessages
    .slice(-5)
    .map((m) => extractMessageText(m).substring(0, 60))
    .join('; ')
    .replace(/\n/g, ' ');

  return `对话涵盖以下话题：${topicHints}`;
}

// ============================================================
// Helpers
// ============================================================

async function findSplitIndex(
  messages: UIMessage[],
  targetTokens: number,
  modelName: string,
): Promise<number> {
  let tokens = 0;
  // 从末尾向前累积，找到分割点
  for (let i = messages.length - 1; i >= 1; i--) {
    const msgTokens = await estimateMessageTokens(messages[i], modelName);
    tokens += msgTokens;
    if (tokens >= targetTokens) {
      return i;
    }
  }
  return 1;
}

function getExistingSummarySafe(conversationId: string, dataStore: DataStore): string | null {
  try {
    const summary = dataStore.summaryStore.getSummaryByConversation(conversationId);
    return summary?.summary || null;
  } catch {
    return null;
  }
}

function saveSummarySafe(
  conversationId: string,
  summary: string,
  lastOrder: number,
  tokenCount: number,
  dataStore: DataStore,
): void {
  try {
    dataStore.summaryStore.saveSummary(conversationId, summary, lastOrder, tokenCount);
  } catch {
    logger.error('ContextWindow', 'Failed to save summary');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
