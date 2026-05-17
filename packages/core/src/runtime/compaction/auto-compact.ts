import type { UIMessage } from "ai";
import { estimateMessagesTokens } from "./token-counter";
import { COMPACT_TOKEN_THRESHOLD } from "./types";
import {
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  CIRCUIT_BREAKER_THRESHOLD,
} from "../../config/defaults";

/**
 * Auto Compact 触发阈值配置
 * 参考指导文档中的设计：
 * - AUTOCOMPACT_BUFFER_TOKENS = 13,000 (触发阈值)
 * - WARNING_THRESHOLD_BUFFER_TOKENS = 20,000 (用户警告)
 * - ERROR_THRESHOLD_BUFFER_TOKENS = 20,000 (错误限制)
 */

// 电路断路器状态
interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number;
  isTripped: boolean;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

const DEFAULT_BUFFER_TOKENS = 13_000;
const DEFAULT_WARNING_BUFFER_TOKENS = 20_000;

/**
 * 获取自动压缩配置（从 resolved config 驱动）
 */
function getAutoCompactConfig(
  compactionThreshold: number,
  bufferTokens?: number,
) {
  const buffer = bufferTokens ?? DEFAULT_BUFFER_TOKENS;
  const warningBuffer = DEFAULT_WARNING_BUFFER_TOKENS;

  // 基础阈值（触发压缩）
  const baseThreshold = compactionThreshold - buffer;

  // 警告阈值（用户警告）
  const warningThreshold = compactionThreshold - warningBuffer;

  // 错误阈值（阻塞限制）
  const errorThreshold = compactionThreshold - warningBuffer;

  return {
    baseThreshold: Math.max(0, baseThreshold),
    warningThreshold: Math.max(0, warningThreshold),
    errorThreshold: Math.max(0, errorThreshold),
  };
}

/**
 * 获取电路断路器状态
 */
function getCircuitBreaker(conversationId: string): CircuitBreakerState {
  const state = circuitBreakers.get(conversationId);

  if (!state) {
    return { failureCount: 0, lastFailureTime: 0, isTripped: false };
  }

  // 检查是否应该重置（超时后）
  const timeSinceLastFailure = Date.now() - state.lastFailureTime;
  if (timeSinceLastFailure > CIRCUIT_BREAKER_RESET_TIMEOUT_MS) {
    const resetState: CircuitBreakerState = {
      failureCount: 0,
      lastFailureTime: 0,
      isTripped: false,
    };
    circuitBreakers.set(conversationId, resetState);
    return resetState;
  }

  return state;
}

/**
 * 记录压缩失败
 */
export function recordCompactFailure(conversationId: string): void {
  const state = getCircuitBreaker(conversationId);
  state.failureCount += 1;
  state.lastFailureTime = Date.now();

  if (state.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    state.isTripped = true;
    console.warn(
      `[Auto Compact] Circuit breaker TRIPPED for ${conversationId} after ${state.failureCount} consecutive failures`,
    );
  }

  circuitBreakers.set(conversationId, state);
}

/**
 * 记录压缩成功（重置电路断路器）
 */
export function recordCompactSuccess(conversationId: string): void {
  circuitBreakers.delete(conversationId);
  console.log(`[Auto Compact] Circuit breaker reset for ${conversationId}`);
}

/**
 * 检查电路断路器是否跳闸
 */
function isCircuitBreakerTripped(conversationId: string): boolean {
  const state = getCircuitBreaker(conversationId);
  return state.isTripped;
}

/**
 * 计算 token 使用量（考虑已释放的 token）
 * 参考指导文档：tokenCountWithEstimation(messages) - snipTokensFreed
 */
async function calculateTokenUsage(
  messages: UIMessage[],
  snipTokensFreed: number = 0,
): Promise<number> {
  const totalTokens = await estimateMessagesTokens(messages);
  return totalTokens - snipTokensFreed;
}

/**
 * 自动压缩触发检查
 *
 * 参考指导文档中的触发条件：
 * 1. 检查自动压缩是否启用（isAutoCompactEnabled()）
 * 2. 计算当前 token 使用 = tokenCountWithEstimation(messages) - snipTokensFreed
 * 3. 若 ≥ threshold - 13K 且 < blockingLimit - 3K，触发压缩
 * 4. 电路断路器: 连续失败 ≥3 次后停止重试
 *
 * @param messages - 当前消息数组
 * @param conversationId - 会话 ID
 * @param snipTokensFreed - 已释放的 token 数（可选）
 * @returns 是否应该触发自动压缩
 */
export async function shouldTriggerAutoCompact(
  messages: UIMessage[],
  conversationId: string,
  snipTokensFreed: number = 0,
  compactionThreshold?: number,
  bufferTokens?: number,
): Promise<boolean> {
  const threshold = compactionThreshold ?? COMPACT_TOKEN_THRESHOLD;
  const config = getAutoCompactConfig(threshold, bufferTokens);

  // 1. 检查电路断路器
  if (isCircuitBreakerTripped(conversationId)) {
    console.log(
      `[Auto Compact] Circuit breaker tripped, skipping auto compact for ${conversationId}`,
    );
    return false;
  }

  // 3. 计算当前 token 使用
  const currentUsage = await calculateTokenUsage(messages, snipTokensFreed);

  // 4. 使用 resolved 触发阈值
  const triggerThreshold = config.baseThreshold;

  // 5. 检查是否达到触发阈值
  const shouldTrigger = currentUsage >= triggerThreshold;

  if (shouldTrigger) {
    console.log(
      `[Auto Compact] Trigger condition met for ${conversationId}: ` +
        `${currentUsage} tokens >= ${triggerThreshold} threshold`,
    );
  }

  return shouldTrigger;
}

/**
 * 获取当前 token 使用状态（用于 UI 显示和警告）
 */
export async function getAutoCompactStatus(
  messages: UIMessage[],
  conversationId: string,
  snipTokensFreed: number = 0,
  compactionThreshold?: number,
  bufferTokens?: number,
): Promise<{
  currentUsage: number;
  triggerThreshold: number;
  warningThreshold: number;
  errorThreshold: number;
  isWarning: boolean;
  isError: boolean;
  shouldTrigger: boolean;
  circuitBreakerTripped: boolean;
}> {
  const threshold = compactionThreshold ?? COMPACT_TOKEN_THRESHOLD;
  const config = getAutoCompactConfig(threshold, bufferTokens);
  const currentUsage = await calculateTokenUsage(messages, snipTokensFreed);
  const circuitBreakerTripped = isCircuitBreakerTripped(conversationId);

  return {
    currentUsage,
    triggerThreshold: config.baseThreshold,
    warningThreshold: config.warningThreshold,
    errorThreshold: config.errorThreshold,
    isWarning: currentUsage >= config.warningThreshold,
    isError: currentUsage >= config.errorThreshold,
    shouldTrigger: await shouldTriggerAutoCompact(
      messages,
      conversationId,
      snipTokensFreed,
      threshold,
      bufferTokens,
    ),
    circuitBreakerTripped,
  };
}

/**
 * 主触发函数：在 API 调用前检查是否需要自动压缩
 *
 * @param messages - 当前消息数组
 * @param conversationId - 会话 ID
 * @param compactionThreshold - 压缩阈值（来自 resolved config）
 * @param bufferTokens - 缓冲区 token 数（来自 compactionConfig.bufferTokens）
 * @returns 是否应该执行压缩
 */
export async function autoCompactIfNeeded(
  messages: UIMessage[],
  conversationId: string,
  compactionThreshold?: number,
  bufferTokens?: number,
): Promise<boolean> {
  if (!(await shouldTriggerAutoCompact(messages, conversationId, 0, compactionThreshold, bufferTokens))) {
    return false;
  }

  console.log(`[Auto Compact] Auto compact triggered for ${conversationId}`);

  return true;
}
