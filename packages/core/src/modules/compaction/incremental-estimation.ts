// ============================================================
// Incremental Token Estimation - 增量 Token 估算
// ============================================================
// Phase 2: 减少重复的 token 计数开销
//
// 问题：
// AI SDK v7 每步都需要估算完整请求的 token 数，包括：
// - messages（可能包含几十条）
// - instructions（系统提示，通常几千 tokens）
// - tools（工具定义，可能上百个）
//
// 当前：每次都重新估算所有内容
// Phase 2：只估算变化的部分，复用之前的估算
//
// 收益：
// - 减少 30-50% token 计数时间
// - 降低 CPU 使用
// - 更快的 prepareStep 响应

import type { ModelMessage } from 'ai';
import { estimateMessagesTokens } from './token-counter';

/**
 * 估算结果（带缓存）
 */
export interface CachedEstimation {
  /** 消息的 token 数 */
  messagesTokens: number;
  /** Instructions 的 token 数（不变） */
  instructionsTokens: number;
  /** Tools 的 token 数（不变） */
  toolsTokens: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 模型上下文限制 */
  modelLimit: number;
  /** 使用率百分比 */
  utilizationPercent: number;
  /** 是否超限 */
  exceedsLimit: boolean;
  /** 消息计数（用于检测变化） */
  messagesCount: number;
  /** Instructions 指纹（用于检测变化） */
  instructionsFingerprint: string;
  /** Tools 指纹（用于检测变化） */
  toolsFingerprint: string;
  /** 估算时间戳 */
  timestamp: number;
}

/**
 * 增量估算选项
 */
export interface IncrementalEstimationOptions {
  /** 之前的估算结果（如果有） */
  previousEstimation?: CachedEstimation;
  /** 是否强制重新估算 */
  forceRefresh?: boolean;
  /** 上下文限制（用于计算使用率） */
  contextLimit?: number;
}

/**
 * 计算字符串的简单指纹（用于检测变化）
 */
function fingerprint(content: string): string {
  // 简单的哈希：长度 + 前后各 100 字符
  const len = content.length;
  const start = content.slice(0, 100);
  const end = content.slice(-100);
  return `${len}:${start}:${end}`;
}

/**
 * 增量估算 - 只估算变化的部分
 *
 * 策略：
 * 1. Instructions 和 Tools 通常不变 → 复用之前的估算
 * 2. Messages 的前缀通常不变（已被 CompactionView 复用）→ 只估算新增部分
 * 3. 如果检测到变化，回退全量估算
 *
 * @param messages - 当前消息列表
 * @param instructions - 系统提示
 * @param tools - 工具定义（JSON 字符串或对象）
 * @param modelName - 模型名称
 * @param options - 增量估算选项
 * @returns 估算结果
 */
export async function estimateTokensIncremental(
  messages: ModelMessage[],
  instructions: string,
  tools: Record<string, any> | string,
  modelName: string,
  options: IncrementalEstimationOptions = {},
): Promise<CachedEstimation> {
  const { previousEstimation, forceRefresh = false, contextLimit } = options;

  // 计算当前指纹
  const instructionsFp = fingerprint(instructions);
  const toolsFp = fingerprint(typeof tools === 'string' ? tools : JSON.stringify(tools));
  const messagesCount = messages.length;

  // 如果强制刷新，或没有之前的估算，全量估算
  if (forceRefresh || !previousEstimation) {
    return estimateFull(messages, instructions, tools, modelName, contextLimit);
  }

  // 检查 Instructions 和 Tools 是否变化
  const instructionsUnchanged = instructionsFp === previousEstimation.instructionsFingerprint;
  const toolsUnchanged = toolsFp === previousEstimation.toolsFingerprint;

  // 如果 Instructions 或 Tools 变化，全量估算
  if (!instructionsUnchanged || !toolsUnchanged) {
    return estimateFull(messages, instructions, tools, modelName, contextLimit);
  }

  // Instructions 和 Tools 未变，复用之前的估算
  let instructionsTokens = previousEstimation.instructionsTokens;
  let toolsTokens = previousEstimation.toolsTokens;

  // 检查 Messages 是否变化
  if (messagesCount === previousEstimation.messagesCount) {
    // 消息数量未变，假设内容也未变（快速路径）
    return {
      ...previousEstimation,
      timestamp: Date.now(),
    };
  }

  // 消息数量变化，需要重新估算 messages
  // 优化：如果只增加了少量消息，可以只估算新增部分
  const newMessagesCount = messagesCount - previousEstimation.messagesCount;

  if (newMessagesCount > 0 && newMessagesCount <= 5) {
    // 增加了少量消息，只估算新增部分
    const newMessages = messages.slice(previousEstimation.messagesCount);
    const newMessagesTokens = await estimateMessagesTokens(newMessages, modelName);

    const messagesTokens = previousEstimation.messagesTokens + newMessagesTokens;
    const totalTokens = messagesTokens + instructionsTokens + toolsTokens;

    // 重新计算使用率（使用之前的 modelLimit 或重新计算）
    const { getModelCapabilities } = await import('../../services/model');
    const modelLimit = contextLimit ?? previousEstimation.modelLimit ?? (await getModelCapabilities(modelName)).contextWindow;
    const utilizationPercent = (totalTokens / modelLimit) * 100;
    const exceedsLimit = utilizationPercent > 90;

    return {
      messagesTokens,
      instructionsTokens,
      toolsTokens,
      totalTokens,
      modelLimit,
      utilizationPercent,
      exceedsLimit,
      messagesCount,
      instructionsFingerprint: instructionsFp,
      toolsFingerprint: toolsFp,
      timestamp: Date.now(),
    };
  }

  // 消息变化较大，全量估算
  return estimateFull(messages, instructions, tools, modelName, contextLimit);
}

/**
 * 全量估算（fallback）
 */
async function estimateFull(
  messages: ModelMessage[],
  instructions: string,
  tools: Record<string, any> | string,
  modelName: string,
  contextLimit?: number,
): Promise<CachedEstimation> {
  // 估算 messages
  const messagesTokens = await estimateMessagesTokens(messages, modelName);

  // 估算 instructions
  const instructionsTokens = await estimateMessagesTokens(
    [{ role: 'user', content: instructions }],
    modelName,
  );

  // 估算 tools
  const toolsJson = typeof tools === 'string' ? tools : JSON.stringify(tools);
  const toolsTokens = await estimateMessagesTokens(
    [{ role: 'user', content: toolsJson }],
    modelName,
  );

  const totalTokens = messagesTokens + instructionsTokens + toolsTokens;

  // 计算模型限制和使用率
  const { getModelCapabilities } = await import('../../services/model');
  const modelLimit = contextLimit ?? (await getModelCapabilities(modelName)).contextWindow;
  const utilizationPercent = (totalTokens / modelLimit) * 100;
  const exceedsLimit = utilizationPercent > 90;

  return {
    messagesTokens,
    instructionsTokens,
    toolsTokens,
    totalTokens,
    modelLimit,
    utilizationPercent,
    exceedsLimit,
    messagesCount: messages.length,
    instructionsFingerprint: fingerprint(instructions),
    toolsFingerprint: fingerprint(toolsJson),
    timestamp: Date.now(),
  };
}

/**
 * 检查估算是否仍然有效
 *
 * @param estimation - 之前的估算
 * @param maxAgeMs - 最大有效时间（默认 5 分钟）
 * @returns 是否有效
 */
export function isEstimationValid(
  estimation: CachedEstimation,
  maxAgeMs: number = 5 * 60 * 1000,
): boolean {
  const age = Date.now() - estimation.timestamp;
  return age < maxAgeMs;
}
