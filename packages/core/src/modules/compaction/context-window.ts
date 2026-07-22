// 后台异步摘要生成。运行结束后 idle 时触发，失败无害。
// 前台同步 LLM 摘要路径已删除——濒死时刻是最差的调 LLM 时机。
// 见 docs/context-invariant-architecture.md

import { generateText } from 'ai';
import type { PipelineMessage } from '../../services/config/compaction-types'
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import { logger } from '../../primitives/logger';
import { extractMessageText, stripImagesFromMessages } from './token-counter';

const SUMMARY_SYSTEM_PROMPT = `你是一个任务型 Agent 的上下文摘要助手。对话即将因超出上下文窗口而被截断，你的摘要将作为唯一的记忆用于继续任务。目标不是复述对话，而是让接手者能无缝继续工作。

请严格按以下结构化模板输出（保留小标题，缺失的部分写"无"）：

## 用户目标 / 验收标准
用户最终想达成什么，以及判断完成的标准。

## 已完成步骤 & 关键结论
按顺序列出已经做了什么、得到了什么结论（含关键数据、命令结果、决策）。

## 涉及的文件路径及改动
列出读过/改过的文件路径，以及每个文件发生了什么改动。用路径原文，不要改写。

## 当前卡点 / 下一步计划
当前遇到的问题，以及接下来打算做什么。

## 用户明确表达的约束与偏好
用户提过的要求、禁止项、风格偏好（如"用中文回复""不要重构无关代码"）。

增量摘要处理：
- 如果输入包含【历史摘要】和【新增对话】，在历史摘要的结构基础上更新，不要丢弃历史信息。
- 新增对话里完成的步骤追加到"已完成步骤"，新触及的文件合并到"涉及的文件"，卡点/计划以最新状态为准。

避免的错误：
❌ 大段复制原文、代码、搜索结果（只记结论和路径，不复制内容）
❌ 用"这是一个很好的问题"等空话
❌ 丢失文件路径、命令、验收标准等可执行的关键信息

请直接输出结构化摘要，不要任何前缀或解释。`;

const MAX_SUMMARY_LENGTH = 6000;
const SUMMARY_MAX_OUTPUT_TOKENS = 3000;

export async function generateAndPersistCheckpointSummary(
  olderMessages: PipelineMessage[],
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    conversationId: string;
    dataStore: DataStore;
    anchorMessageId: string;
  },
): Promise<boolean> {
  const stripped = stripImagesFromMessages(olderMessages);
  const conversationText = stripped.map((m) => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    return `${role}: ${extractMessageText(m)}`;
  }).join('\n\n');

  const existing = getExistingSummarySafe(context.conversationId, context.dataStore);
  const prompt = existing
    ? `【历史摘要】\n${existing}\n\n【新增对话】\n${conversationText}`
    : conversationText;

  const summary = await callWithFallback(prompt, context.model, context.fallbackModels);
  if (!summary || !validateSummaryQuality(summary, stripped)) {
    return false;
  }

  try {
    context.dataStore.summaryStore.saveSummary(
      context.conversationId, summary, olderMessages.length - 1, 0, context.anchorMessageId,
    );
    return true;
  } catch (err) {
    logger.warn('ContextWindow', 'Failed to persist checkpoint summary:', err);
    return false;
  }
}

async function callWithFallback(
  prompt: string,
  model: LanguageModelV3,
  fallbackModels?: LanguageModelV3[],
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await generateText({
        model,
        instructions: SUMMARY_SYSTEM_PROMPT,
        prompt,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      });
      if (text?.trim()) return text.trim();
    } catch (err) {
      logger.warn('ContextWindow', `Summary attempt ${attempt + 1} failed:`, err);
      if (attempt === 0) await delay(2000);
    }
  }
  for (const fb of fallbackModels ?? []) {
    try {
      const { text } = await generateText({
        model: fb,
        instructions: SUMMARY_SYSTEM_PROMPT,
        prompt,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      });
      if (text?.trim()) return text.trim();
    } catch {
      // ignore
    }
  }
  return null;
}

export function validateSummaryQuality(summary: string, messages: PipelineMessage[]): boolean {
  if (!summary || summary.length < 20) return false;
  if (summary.length > MAX_SUMMARY_LENGTH) {
    logger.warn('ContextWindow', `Summary too long (${summary.length} chars), likely copying content`);
    return false;
  }

  // 简单复制检测：摘要不应是任意单条消息的原文复制
  const allTexts = messages.map((m) => extractMessageText(m));
  for (const text of allTexts) {
    if (text && text.length > 10 && summary.includes(text)) {
      logger.warn('ContextWindow', 'Summary contains verbatim copy of a message');
      return false;
    }
  }

  return true;
}

function getExistingSummarySafe(conversationId: string, dataStore: DataStore): string | null {
  try {
    const summary = dataStore.summaryStore.getSummaryByConversation(conversationId);
    return summary?.summary || null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}