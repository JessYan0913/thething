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
  estimateFullRequest,
  estimateMessageTokens,
  extractMessageText,
  stripImagesFromMessages,
} from './token-counter';
import { getModelContextLimit } from '../../services/model';

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
  },
): Promise<{ messages: UIMessage[]; executed: boolean; tokensFreed: number }> {
  const config = context.config ?? DEFAULT_CONTEXT_WINDOW_CONFIG;

  // 估算当前 token 总量
  const estimation = await estimateFullRequest(messages, '', {}, context.modelName);
  const contextLimit = getModelContextLimit(context.modelName, context.contextLimit);
  const triggerTokens = Math.floor(contextLimit * config.triggerPercent);

  if (estimation.messagesTokens < triggerTokens) {
    return { messages, executed: false, tokensFreed: 0 };
  }

  // 计算目标 token 数
  const targetTokens = Math.floor(contextLimit * config.targetPercent);
  const targetMessageTokens = Math.max(0, targetTokens - estimation.instructionsTokens
    - estimation.toolsTokens - estimation.outputReserve);

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
    role: 'system',
    parts: [{ type: 'text', text: `[Previous conversation summary]\n${summary}\n[End of summary]` }],
  };

  const result = [summaryMessage, ...newerMessages];

  const newEstimation = await estimateFullRequest(result, '', {}, context.modelName);
  const tokensFreed = Math.max(0, estimation.messagesTokens - newEstimation.messagesTokens);

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
        system: SUMMARY_SYSTEM_PROMPT,
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
        system: SUMMARY_SYSTEM_PROMPT,
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

function validateSummaryQuality(summary: string, messages: UIMessage[]): boolean {
  if (!summary || summary.length < 10) return false;
  if (summary.length > MAX_SUMMARY_LENGTH) {
    logger.warn('ContextWindow', `Summary too long (${summary.length} chars), likely copying content`);
    return false;
  }

  const userMessages = messages.filter((m) => m.role === 'user');
  if (userMessages.length === 0) return true;

  const lastUserText = extractMessageText(userMessages[userMessages.length - 1]);
  if (lastUserText.length < 5) return true;

  const summaryLower = summary.toLowerCase();
  const keyPhrases = lastUserText
    .substring(0, 30)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const matchCount = keyPhrases.filter((phrase) => summaryLower.includes(phrase)).length;
  return matchCount >= 1 || summaryLower.includes('topic') || summaryLower.includes('then');
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
