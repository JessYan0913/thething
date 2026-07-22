// ============================================================
// Compaction - Checkpoint Summary Generation
// ============================================================
// 后台异步摘要生成。运行结束后 idle 时触发，失败无害。
// 前台同步 LLM 摘要路径已删除——濒死时刻是最差的调 LLM 时机。
// 见 docs/context-invariant-architecture.md。

import { generateText } from 'ai';
import type { PipelineMessage } from '../../services/config/compaction-types'
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DataStore } from '../../primitives/datastore/types';
import { logger } from '../../primitives/logger';
import {
  extractMessageText,
  stripImagesFromMessages,
} from './token-counter';

// ============================================================
// Summary Prompt
// ============================================================

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

// 结构化摘要比叙事体长，放宽上限——摘要的目的是保任务连续性，不是省 token
const MAX_SUMMARY_LENGTH = 6000;

// LLM 摘要生成的输出上限（tokens），需容纳结构化模板
const SUMMARY_MAX_OUTPUT_TOKENS = 3000;

// ============================================================
// Summary Generation（后台 Checkpoint，纯异步）
// ============================================================

/**
 * 后台 checkpoint 摘要:生成并带锚点落库。
 * 前台同步 LLM 摘要（原 enforceContextWindow）已删除——濒死时刻是
 * 最差的调 LLM 时机。这里失败无害(下次运行重试)，
 * @returns 是否成功落库
 */
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

  // 增量:已有摘要时在其基础上更新(applyCheckpointOnLoad 的锚点推进由调用方保证)
  const existing = getExistingSummarySafe(context.conversationId, context.dataStore);
  const prompt = existing
    ? `【历史摘要】\n${existing}\n\n【新增对话】\n${conversationText}`
    : conversationText;

  const summary = await callWithFallback(prompt, context.model, context.fallbackModels);
  if (!summary || !validateSummaryQuality(summary, olderMessages)) {
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
  // 主模型尝试 2 次
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
  // fallback 模型各 1 次
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

// ============================================================
// Quality Validation
// ============================================================

/**
 * 验证摘要质量 - 语言无关的验证逻辑
 * 见 docs/context-compaction-analysis.md #3
 * （导出仅用于测试）
 */
export function validateSummaryQuality(summary: string, messages: PipelineMessage[]): boolean {
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

// ============================================================
// Helpers
// ============================================================

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
