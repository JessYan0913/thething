// ============================================================
// Context Invariant Gate - 上下文不变量闸门
// ============================================================
// 唯一的上下文预算强制点。不压缩，不配置，无豁免。
// 如果请求超出窗口 -> 拒绝并返回 413。
//
// 不变量：发送到模型的请求 ≤ 上下文窗口
//
// 这是"做减法"重构的最后一道防线：
// 任何压缩机制失效时，闸门保证不向模型发送超标请求。
// 见 docs/context-invariant-architecture.md。
// ============================================================

import type { Tool } from 'ai';

import { estimateFullRequest, type FullRequestEstimation } from './token-counter';
import { logger } from '../../primitives/logger';

export interface GateResult {
  /** 闸门是否通过 */
  passed: boolean;
  /** 请求总 token 数 */
  totalTokens: number;
  /** 上下文窗口上限 */
  contextLimit: number;
  /** 利用率百分比 */
  utilizationPercent: number;
  /** 分项明细 */
  breakdown: {
    messages: number;
    instructions: number;
    tools: number;
    outputReserve: number;
  };
  /** 决策日志（REJECT 时含原因，WARN 时含预警） */
  decision: string;
}

/**
 * 从已有估算结果判定闸门。纯函数--不估算、不压缩、不调用 LLM。
 *
 * 供已持有 FullRequestEstimation 的调用方复用（如 prepareStep 复用 context bar
 * 的估算），避免重复估算。判定/日志逻辑与 assertContextInvariant 完全一致。
 */
export function gateFromEstimation(estimation: FullRequestEstimation): GateResult {
  const result: GateResult = {
    passed: !estimation.exceedsLimit,
    totalTokens: estimation.totalTokens,
    contextLimit: estimation.modelLimit,
    utilizationPercent: estimation.utilizationPercent,
    breakdown: {
      messages: estimation.messagesTokens,
      instructions: estimation.instructionsTokens,
      tools: estimation.toolsTokens,
      outputReserve: estimation.outputReserve ?? 0,
    },
    decision: '',
  };

  if (!result.passed) {
    const reason = `msgs=${estimation.messagesTokens}+inst=${estimation.instructionsTokens}+tools=${estimation.toolsTokens}+out=${estimation.outputReserve ?? 0} = ${estimation.totalTokens} > ${estimation.modelLimit}`;
    result.decision = `REJECT: ${reason}`;
    logger.warn('Gate', result.decision);
  } else if (estimation.utilizationPercent > 80) {
    result.decision = `WARN: ${estimation.utilizationPercent.toFixed(1)}% utilization`;
    logger.info('Gate', result.decision, {
      msgTokens: estimation.messagesTokens,
      instTokens: estimation.instructionsTokens,
      toolTokens: estimation.toolsTokens,
      limit: estimation.modelLimit,
    });
  } else {
    result.decision = `PASS: ${estimation.utilizationPercent.toFixed(1)}%`;
  }

  return result;
}

/**
 * 断言上下文不变量：发送给模型的请求必须在窗口范围内。
 *
 * 这是纯验证函数--不修改消息，不调用 LLM，不压缩。
 * 超标时返回 passed: false，调用方应映射为 413 或抛
 * CONTEXT_BUDGET_EXCEEDED。
 *
 * @param messages 待发送的消息
 * @param instructions 系统提示词
 * @param tools 工具集
 * @param modelName 模型名称（用于获取窗口大小）
 * @param contextLimit 外部指定的上下文上限（可选）
 */
export async function assertContextInvariant(
  messages: import('ai').ModelMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string,
  contextLimit?: number,
): Promise<GateResult> {
  const estimation = await estimateFullRequest(messages, instructions, tools, modelName, contextLimit);
  return gateFromEstimation(estimation);
}
