// ============================================================
// Request Budget - 完整请求估算组装（策略 + 校准 buffer）
// ============================================================
// 统一预算策略（见 docs/compaction-redesign.md L1）：
//
//   totalTokensWithBuffer = messages + instructions + tools + outputReserve
//                         + tokenizerBuffer
//   tokenizerBuffer = (messages+instructions+tools) × (driftRatio − 1)
//
// tokenizerBuffer 由 usage 真值 EMA 校准（usage-calibrator）驱动，替代静态
// "拍脑袋"buffer。冷启动为 0（不额外加 buffer），首个真值样本接管后收敛；
// 静态兜底由 deriveBudget 的 encode-level buffer 承担。
// 设计契约：tokenizerBuffer 恒非负（校准比率 <1 即本地估算偏保守时负 buffer
// 在数学上有意义，但 payload schema 要求 nonnegative，故兜底截断为 0——
// 宁保守不报错）。
//
// 触发判断用 totalTokensWithBuffer 对比 policy.triggerTokens / hardLimitTokens
// （见 compaction-redesign.md L1 触发语义），确保小窗口（如 22.8k）也按真实
// 可用预算决策，而不是等 100% 超限。

import type { Tool } from 'ai';
import {
  estimateFullRequest,
  type FullRequestEstimation,
} from './token-counter';
import { getEstimatorInfra } from './tokenizer';
import { deriveBudget } from './prompt-budget-policy';

export interface RequestBudgetEstimation extends FullRequestEstimation {
  /** 校准 buffer（tokens）：baseTokens × (driftRatio − 1)，对全部模型统一生效 */
  tokenizerBuffer: number;
  /** 含校准 buffer 的总量（上报水位 / 触发判断用） */
  totalTokensWithBuffer: number;
  /** 触发判断硬不变量：含校准 buffer 的总量是否超过窗口（闸门用此而非 exceedsLimit） */
  exceedsLimitWithBuffer: boolean;
  /** 主动压缩触发线（deriveBudget.triggerTokens） */
  triggerTokens: number;
  /** 强制降级硬限（deriveBudget.hardLimitTokens） */
  hardLimitTokens: number;
  /** 达到触发线：应主动升档压缩 */
  shouldTrigger: boolean;
  /** 达到硬限：应强制降级 */
  shouldForce: boolean;
}

/**
 * 完整请求估算 + 校准 buffer + 策略判断。
 *
 * 校准只在聚合层应用一次（见 compaction-redesign.md L1）：计数源头 drift-agnostic
 * 以保证与消息级缓存兼容，此处按 base × (driftRatio − 1) 统一叠加校准 buffer，
 * totalTokensWithBuffer 是决策/闸门的权威口径。
 *
 * 复用 estimateFullRequest 的基线（BPE 精确计数 + 消息级缓存），并从同一 policy
 * 推导触发线/硬限。
 */
export async function estimateRequestBudget(
  messages: import('ai').ModelMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string,
  contextLimitOverride?: number,
  /** per-model outputTokens（ModelEntry.outputTokens）——动态 outputReserve，使预算与模型实际输出能力一致 */
  outputTokensOverride?: number,
): Promise<RequestBudgetEstimation> {
  const base = await estimateFullRequest(messages, instructions, tools, modelName, contextLimitOverride, outputTokensOverride);
  const { calibrator } = getEstimatorInfra();
  const bufferRatio = calibrator.getTokenizerBufferRatio(modelName);
  const baseTokens = base.messagesTokens + base.instructionsTokens + base.toolsTokens;
  const tokenizerBuffer = Math.max(0, Math.round(baseTokens * bufferRatio));
  const totalTokensWithBuffer = base.totalTokens + tokenizerBuffer;
  const exceedsLimitWithBuffer = totalTokensWithBuffer > base.modelLimit;

  const policy = deriveBudget(base.modelLimit, base.outputReserve, modelName);
  const shouldTrigger = totalTokensWithBuffer >= policy.triggerTokens;
  const shouldForce = totalTokensWithBuffer >= policy.hardLimitTokens;

  return {
    ...base,
    tokenizerBuffer,
    totalTokensWithBuffer,
    exceedsLimitWithBuffer,
    triggerTokens: policy.triggerTokens,
    hardLimitTokens: policy.hardLimitTokens,
    shouldTrigger,
    shouldForce,
  };
}
