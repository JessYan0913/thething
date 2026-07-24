// ============================================================
// Agent Compress - 统一的 Agent 驱动压缩器
// ============================================================
// 主模型读自己的真实对话(不拍扁 role:text、不按位置预切、不 slice(0,800) 截断),
// 自决保留 prose 摘要 + 原样项(文件路径 / 命令 / 关键结论)。
//
// 两条路径共用:
//   A 运行结束 idle(maybeCheckpointAfterRun)--落库供重载;
//   B 每步前濒死(applyEmergencyCompression)--返回压缩后消息 + 更新 compactionView。
//
// 输入按当前模型窗口 W 裁定(增量:历史摘要 + 锚点后新消息),默认成功。
// forceTruncate 已删;极端仍超限由闸门 413 兜底(见 gate.ts / pipeline.ts)。
// 见 docs/context-compaction-redesign.md P2。
// ============================================================

import { generateText } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ModelMessage } from 'ai';
import type { DataStore } from '../../primitives/datastore/types';

import { stripImagesFromMessages, estimateMessageTokens, extractMessageText } from './token-counter';
import { buildSummaryMessage } from './message-view';
import { validateSummaryQuality } from './context-window';
import { getModelContextLimit } from '../../services/model';
import { logger } from '../../primitives/logger';

const SUMMARY_MAX_OUTPUT_TOKENS = 3000;

/** 自指涉压缩提示词:模型在继续自己的任务,压缩到能无缝接手。 */
const COMPRESSION_PROMPT = `你在继续自己的任务。下面的对话即将因超出上下文窗口而被压缩,你的摘要将作为唯一记忆用于无缝接手(接手者就是压缩后的你)。

目标不是复述对话,而是让接手者能继续工作。请按以下结构输出(保留小标题,缺失部分写"无"):

## 用户目标 / 验收标准
用户最终想达成什么,以及判断完成的标准。

## 已完成步骤 & 关键结论
按顺序列出已经做了什么、得到了什么结论(含关键数据、命令结果、决策)。

## 涉及的文件路径及改动
列出读过/改过的文件路径,以及每个文件发生了什么改动。用路径原文,不要改写。

## 当前卡点 / 下一步计划
当前遇到的问题,以及接下来打算做什么。

## 用户明确表达的约束与偏好
用户提过的要求、禁止项、风格偏好(如"用中文回复""不要重构无关代码")。

## 可找回的工具输出
凡是原文出现的 "Full output saved to: <路径>" 或 "[saved to: ...]" 等找回路径,原样逐行列出(后续步骤靠这些路径用 read_file 找回工具输出)。

增量处理:如果输入以【历史摘要】开头,在历史摘要的结构基础上更新,不要丢弃历史信息;新增对话里完成的步骤追加到"已完成步骤",新触及的文件合并到"涉及的文件",卡点/计划以最新状态为准。

硬约束(必须遵守):
✅ 文件路径、命令、关键结论原样保留,不得改写、缩写、省略目录层级
✅ tool-result 里的找回路径逐行列出
❌ 大段复制原文、代码、搜索结果内容(只记结论和路径)
❌ 用"这是一个很好的问题"等空话
❌ 丢失文件路径、命令、验收标准等可执行的关键信息

直接输出结构化摘要,不要任何前缀或解释。`;

/** 锚点后保留的尾部占比(连续对话引用) */
export const KEEP_PERCENT = 0.3;
/** 锚点之后至少保留的消息条数 */
const MIN_KEEP_MESSAGES = 2;
/** 分块压缩:每块占窗口的比例(留 40% 余量给提示词 + 上一轮摘要 + 输出预留,对估算误差稳健) */
const CHUNK_FRACTION = 0.6;
/** 每块 token 下限(极小窗口时避免块过碎) */
const MIN_CHUNK_TOKENS = 1000;

export interface AgentCompressContext {
  model: LanguageModelV3;
  fallbackModels?: LanguageModelV3[];
  modelName: string;
  /** 当前模型上下文窗口上限(用于分块预算);不提供则用模型默认窗口 */
  contextLimit?: number;
  /** 提供(且 dataStore 提供)时走增量 + 落库;否则按首轮/不落库处理 */
  conversationId?: string;
  dataStore?: DataStore;
  /** 提供则落库(Path A 供重载);不提供则不落库(Path B 在 P2 仅更新视图,P3 再接落库) */
  anchorMessageId?: string;
}

export interface AgentCompressResult {
  success: boolean;
  summaryText?: string;
  summaryMessage?: ModelMessage;
}

/**
 * 共享切分:从末尾往前保留 ≈ KEEP_PERCENT 的 token 作为尾部(锚点后,原样保留),
 * 其余进入摘要段。返回 splitIndex(尾部起点)。
 *
 * 不按"中间 60% / 尾部 30%"预切--只区分"锚点前的老消息(压缩)"与"锚点后(保留)"。
 * 切什么由锚点定,不由百分比赌。
 */
export async function findCompressionSplit(
  messages: ModelMessage[],
  startIndex: number,
  modelLimit: number,
  modelName: string,
  keepPercent: number = KEEP_PERCENT,
): Promise<number> {
  const keepBudget = modelLimit * keepPercent;
  let kept = 0;
  let splitIndex = messages.length;
  for (let i = messages.length - 1; i > startIndex; i--) {
    kept += await estimateMessageTokens(messages[i], modelName);
    if (kept >= keepBudget) {
      splitIndex = i;
      break;
    }
    splitIndex = i;
  }
  return Math.min(splitIndex, messages.length - MIN_KEEP_MESSAGES);
}

/**
 * 统一压缩:把 olderMessages(真实 ModelMessage,已切分)交给主模型生成摘要。
 *
 * - 分块(核心):待压段超过单次输入预算时,按 token 分块**折叠压缩**--每块前置上一轮摘要,
 *   逐块压成一份。每块输入 ≤ 窗口,故任意大的待压段都能压(不再因输入 > W 而摘要调用失败)。
 * - 增量:summaryStore 已有摘要时作为【历史摘要】前置(折叠的起点)。
 * - 保真:restoreMissingPaths 确定性补回 tool-result 找回路径(不依赖模型行为)。
 * - 落库:提供 anchorMessageId 时写 summaryStore(Path A)。
 *
 * @returns success=false 表示某块摘要为空/不达标,调用方回退(由闸门兜底,不 forceTruncate)
 */
export async function agentCompress(
  olderMessages: ModelMessage[],
  context: AgentCompressContext,
): Promise<AgentCompressResult> {
  if (olderMessages.length === 0) {
    return { success: false };
  }

  const existing = getExistingSummarySafe(context.conversationId, context.dataStore);
  const windowLimit = getModelContextLimit(context.modelName, context.contextLimit);
  // 每块 token 预算:留出提示词 + 上一轮摘要 + 输出预留 + 余量
  const chunkBudget = Math.max(Math.floor(windowLimit * CHUNK_FRACTION), MIN_CHUNK_TOKENS);

  // 按 token 预算分块(从前到后,整条消息不切;单条超预算自成一块)
  const { chunks, totalTokens } = await splitIntoTokenBoundedChunks(
    olderMessages, chunkBudget, context.modelName,
  );

  // 折叠压缩:running summary 前置,逐块喂主模型,合成一份
  let runningSummary: string | null = existing;
  for (let i = 0; i < chunks.length; i++) {
    const stripped = stripImagesFromMessages(chunks[i]);
    const input: ModelMessage[] = runningSummary
      ? ([{ role: 'user', content: `【历史摘要】\n${runningSummary}` } as ModelMessage, ...stripped])
      : stripped;
    const out = await callWithFallback(input, context.model, context.fallbackModels);
    if (!out || !validateSummaryQuality(out, stripped)) {
      logger.warn('AgentCompress', `第 ${i + 1}/${chunks.length} 块摘要失败/不达标,放弃(交闸门)`);
      return { success: false };
    }
    runningSummary = out;
  }

  const summary = runningSummary!;

  // 确定性补回:tool-result 找回路径(从全部 olderMessages 提取,不依赖模型是否保留)
  const persistedPaths = extractPersistedPaths(olderMessages);
  const summaryText = restoreMissingPaths(summary, persistedPaths);
  const restoredCount = persistedPaths.filter((p) => !summary.includes(p)).length;

  logger.info(
    'AgentCompress',
    `[②] fired chunks=${chunks.length} in=${totalTokens}tok out=${summaryText.length}chars restored=${restoredCount} persisted=${!!(context.anchorMessageId && context.conversationId && context.dataStore)} | conv=${context.conversationId ?? '?'}`,
  );

  if (context.anchorMessageId && context.conversationId && context.dataStore) {
    try {
      context.dataStore.summaryStore.saveSummary(
        context.conversationId,
        summaryText,
        olderMessages.length - 1,
        0,
        context.anchorMessageId,
      );
    } catch (err) {
      logger.warn('AgentCompress', '落库失败:', err);
    }
  }

  const summaryMessage = buildSummaryMessage(summaryText, 'model') as ModelMessage;
  return { success: true, summaryText, summaryMessage };
}

/**
 * 按 token 预算分块(从前到后)。整条消息不切;单条超预算的消息自成一块。
 * @returns chunks 分块 + totalTokens 全部消息 token 总和
 */
async function splitIntoTokenBoundedChunks(
  messages: ModelMessage[],
  budget: number,
  modelName: string,
): Promise<{ chunks: ModelMessage[][]; totalTokens: number }> {
  const chunks: ModelMessage[][] = [];
  let current: ModelMessage[] = [];
  let currentTokens = 0;
  let totalTokens = 0;
  for (const m of messages) {
    const t = await estimateMessageTokens(m, modelName);
    totalTokens += t;
    if (currentTokens + t > budget && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(m);
    currentTokens += t;
  }
  if (current.length > 0) chunks.push(current);
  return { chunks: chunks.length > 0 ? chunks : [messages], totalTokens };
}

/**
 * 调主模型生成摘要,2 次重试 + 备用模型。失败返回 null(调用方回退)。
 */
async function callWithFallback(
  messages: ModelMessage[],
  model: LanguageModelV3,
  fallbackModels?: LanguageModelV3[],
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await generateText({
        model,
        instructions: COMPRESSION_PROMPT,
        messages,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      });
      if (text?.trim()) return text.trim();
    } catch (err) {
      logger.warn('AgentCompress', `摘要尝试 ${attempt + 1}/2 失败:`, err);
      if (attempt === 0) await delay(2000);
    }
  }
  for (const fb of fallbackModels ?? []) {
    try {
      const { text } = await generateText({
        model: fb,
        instructions: COMPRESSION_PROMPT,
        messages,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      });
      if (text?.trim()) return text.trim();
    } catch (err) {
      logger.warn('AgentCompress', '备用模型失败:', err);
    }
  }
  return null;
}

function getExistingSummarySafe(conversationId: string | undefined, dataStore: DataStore | undefined): string | null {
  if (!conversationId || !dataStore) return null;
  try {
    return dataStore.summaryStore.getSummaryByConversation(conversationId)?.summary || null;
  } catch {
    return null;
  }
}

// ============================================================
// 确定性保真:tool-result 找回路径补回
// ============================================================

const PERSISTED_PATH_PATTERN = /Full output saved to:\s*([^\s\]]+)/g;
const SAVED_TO_PATTERN = /\[saved to:\s*([^\s\]]+)\]/g;

/** 提取消息里所有工具输出落盘找回路径 */
function extractPersistedPaths(messages: ModelMessage[]): string[] {
  const paths = new Set<string>();
  for (const m of messages) {
    const text = extractMessageText(m);
    for (const match of text.matchAll(PERSISTED_PATH_PATTERN)) if (match[1]) paths.add(match[1]);
    for (const match of text.matchAll(SAVED_TO_PATTERN)) if (match[1]) paths.add(match[1]);
  }
  return [...paths];
}

/** 模型丢掉的路径,确定性补回摘要末尾 */
function restoreMissingPaths(summaryText: string, paths: string[]): string {
  if (paths.length === 0) return summaryText;
  const missing = paths.filter((p) => !summaryText.includes(p));
  if (missing.length === 0) return summaryText;
  const block =
    '\n\n## 可找回的工具输出（原样路径，可用 read_file 读取）\n' +
    missing.map((p) => `- ${p}`).join('\n');
  return summaryText + block;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
