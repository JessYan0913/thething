// ============================================================
// Emergency Summary - Layer 3: 紧急 LLM 摘要
// ============================================================
// 当 Layer 2 和 Layer 2.5 都无法满足预算时的最后手段。
// 使用快速模型生成摘要，有超时保护。
//
// 改进点（相比被删除的同步 LLM 路径）：
// 1. 使用快速模型（claude-haiku-4）
// 2. 30 秒超时保护
// 3. 渐进式压缩（只压缩中间 50%）
// 4. 保留首尾消息（任务目标 + 当前上下文）

import { generateText } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';

import { extractMessageText, stripImagesFromMessages } from './token-counter';
import { buildSummaryMessage } from './message-view';
import { logger } from '../../primitives/logger';

/**
 * 紧急摘要结果
 */
export interface EmergencySummaryResult {
  /** 压缩后的消息 */
  messages: import('ai').ModelMessage[];
  /** 是否成功生成摘要 */
  success: boolean;
  /** 失败原因（如果失败） */
  error?: string;
}

/**
 * 紧急摘要配置
 */
export interface EmergencySummaryConfig {
  /** 使用的模型 */
  model: LanguageModelV3;
  /** 备用模型列表 */
  fallbackModels?: LanguageModelV3[];
  /** 目标压缩比例（0.5 = 压缩到 50%） */
  targetPercent: number;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30000; // 30 秒
const EMERGENCY_SUMMARY_PROMPT = `你是一个任务型 Agent 的上下文摘要助手。对话过长，需要压缩以继续任务。

目标：提取关键信息，让接手者能无缝继续工作。

请严格按以下结构输出：

## 用户目标
用户最终想达成什么

## 已完成步骤
按顺序列出做了什么、得到了什么结论

## 涉及的文件
列出读过/改过的文件路径（用原文路径）

## 当前状态
当前在做什么，遇到什么问题

避免的错误：
❌ 大段复制原文、代码
❌ 用空话（"这是一个很好的问题"）
❌ 丢失文件路径、命令等关键信息

直接输出摘要，不要前缀或解释。`;

/**
 * 紧急摘要：快速、有超时保护、渐进式
 *
 * @param messages 待压缩的消息
 * @param config 摘要配置
 * @returns 摘要结果
 */
export async function emergencySummarize(
  messages: import('ai').ModelMessage[],
  config: EmergencySummaryConfig,
): Promise<EmergencySummaryResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    // 1. 保留首尾，只压缩中间部分
    const { firstUserMsg, recentMessages, middleMessages } = splitMessages(messages, config.targetPercent);

    if (middleMessages.length < 5) {
      // 中间部分太短，不值得摘要
      logger.debug('EmergencySummary', '中间消息太少，跳过摘要');
      return { messages, success: false };
    }

    // 2. 调用快速模型生成摘要，带超时保护
    logger.info('EmergencySummary', `开始生成摘要（压缩 ${middleMessages.length} 条消息，超时 ${timeoutMs}ms）`);

    const summaryText = await Promise.race([
      generateSummaryFast(middleMessages, config.model, config.fallbackModels),
      createTimeout(timeoutMs, '摘要超时'),
    ]);

    if (!summaryText) {
      logger.warn('EmergencySummary', '摘要生成失败（空结果）');
      return { messages, success: false };
    }

    // 3. 构建压缩后的消息
    const summaryMessage = buildSummaryMessage(summaryText, 'ui') as import('ai').ModelMessage;
    const compressedMessages = [firstUserMsg, summaryMessage, ...recentMessages];

    logger.info('EmergencySummary', `摘要成功: ${messages.length} → ${compressedMessages.length} 条消息`);

    return {
      messages: compressedMessages,
      success: true,
    };
  } catch (err: any) {
    logger.warn('EmergencySummary', '摘要失败:', err);
    return {
      messages,
      success: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * 分割消息：保留首尾，返回中间部分
 */
interface SplitResult {
  firstUserMsg: import('ai').ModelMessage;
  recentMessages: import('ai').ModelMessage[];
  middleMessages: import('ai').ModelMessage[];
}

function splitMessages(messages: import('ai').ModelMessage[], targetPercent: number): SplitResult {
  // 找到第一条 user 消息
  const firstUserIndex = messages.findIndex((m) => m.role === 'user');
  const firstUserMsg = messages[firstUserIndex] || messages[0];

  // 计算保留多少尾部消息（至少 30%）
  const keepPercent = Math.max(0.3, 1 - targetPercent);
  const recentCount = Math.max(10, Math.floor(messages.length * keepPercent));
  const recentMessages = messages.slice(-recentCount);

  // 中间部分
  const middleStart = firstUserIndex + 1;
  const middleEnd = messages.length - recentCount;
  const middleMessages = middleEnd > middleStart ? messages.slice(middleStart, middleEnd) : [];

  return {
    firstUserMsg,
    recentMessages,
    middleMessages,
  };
}

/**
 * 快速生成摘要
 */
async function generateSummaryFast(
  messages: import('ai').ModelMessage[],
  model: LanguageModelV3,
  fallbackModels?: LanguageModelV3[],
): Promise<string | null> {
  // 构建对话文本（限制每条消息的长度）
  const stripped = stripImagesFromMessages(messages);
  const conversationText = stripped
    .map((m) => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const text = extractMessageText(m);
      // 限制每条消息最多 800 字符，避免输入过大
      const preview = text.length > 800 ? text.slice(0, 800) + '...' : text;
      return `${role}: ${preview}`;
    })
    .join('\n\n');

  // 尝试主模型 2 次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await generateText({
        model,
        instructions: EMERGENCY_SUMMARY_PROMPT,
        prompt: conversationText,
        maxOutputTokens: 1500, // 限制输出长度
      });

      if (text?.trim()) {
        logger.debug('EmergencySummary', `主模型成功（尝试 ${attempt + 1}/2）`);
        return text.trim();
      }
    } catch (err) {
      logger.warn('EmergencySummary', `主模型尝试 ${attempt + 1}/2 失败:`, err);
      if (attempt === 0) {
        await delay(1000); // 重试前等待 1 秒
      }
    }
  }

  // 尝试备用模型
  if (fallbackModels && fallbackModels.length > 0) {
    for (const fallbackModel of fallbackModels) {
      try {
        logger.info('EmergencySummary', '尝试备用模型');
        const { text } = await generateText({
          model: fallbackModel,
          instructions: EMERGENCY_SUMMARY_PROMPT,
          prompt: conversationText,
          maxOutputTokens: 1500,
        });

        if (text?.trim()) {
          logger.debug('EmergencySummary', '备用模型成功');
          return text.trim();
        }
      } catch (err) {
        logger.warn('EmergencySummary', '备用模型失败:', err);
      }
    }
  }

  return null;
}

/**
 * 创建超时 Promise
 */
function createTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * 延迟工具
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
