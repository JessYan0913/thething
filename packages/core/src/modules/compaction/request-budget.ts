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
  estimateMessagesTokens,
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
  /**
   * provider 真实 usage 锚点（本 run 内上游 step 的 usage，见 pipeline 步级闸门）。
   * 传入时以真值为基线：inputTokens 已含至最后一条 assistant 的完整 prompt（含指令与工具），
   * 加 outputTokens（该 assistant 自身输出，现已是上下文的一部分），仅对锚点之后的尾巴做
   * 本地估算；tokenizerBuffer 置 0（真值无需漂移缓冲，避免双计）。不传则沿用全量重估 ×
   * 校准 buffer（原路径）。messages 中无 assistant 时回退原路径。
   */
  anchorUsage?: { inputTokens: number; outputTokens: number },
): Promise<RequestBudgetEstimation> {
  const base = await estimateFullRequest(messages, instructions, tools, modelName, contextLimitOverride);

  // 锚定模式：messagesTokens 用真值分解替换局部估算（inputTokens 含指令/工具，
  // 减去估算份额即 history 的真值跨度），totalTokens 同源重算。
  let anchored = false;
  let messagesTokens = base.messagesTokens;
  let totalTokens = base.totalTokens;
  if (anchorUsage && anchorUsage.inputTokens > 0) {
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx !== -1) {
      anchored = true;
      const trailingTokens = await estimateMessagesTokens(messages.slice(lastAssistantIdx + 1), modelName);
      const anchoredInputSpan = anchorUsage.inputTokens - base.instructionsTokens - base.toolsTokens;
      messagesTokens = Math.max(0, anchoredInputSpan) + anchorUsage.outputTokens + trailingTokens;
      totalTokens = messagesTokens + base.instructionsTokens + base.toolsTokens + base.outputReserve;
    }
  }

  const { calibrator } = getEstimatorInfra();
  const bufferRatio = calibrator.getTokenizerBufferRatio(modelName);
  const baseTokens = messagesTokens + base.instructionsTokens + base.toolsTokens;
  const tokenizerBuffer = anchored ? 0 : Math.max(0, Math.round(baseTokens * bufferRatio));
  const totalTokensWithBuffer = totalTokens + tokenizerBuffer;
  const exceedsLimit = totalTokens > base.modelLimit;
  const exceedsLimitWithBuffer = totalTokensWithBuffer > base.modelLimit;
  const availableBudget = base.modelLimit - totalTokens;
  const utilizationPercent = (totalTokens / base.modelLimit) * 100;

  const policy = deriveBudget(base.modelLimit, base.outputReserve, modelName);
  const shouldTrigger = totalTokensWithBuffer >= policy.triggerTokens;
  const shouldForce = totalTokensWithBuffer >= policy.hardLimitTokens;

  return {
    ...base,
    messagesTokens,
    totalTokens,
    availableBudget,
    exceedsLimit,
    utilizationPercent,
    tokenizerBuffer,
    totalTokensWithBuffer,
    exceedsLimitWithBuffer,
    triggerTokens: policy.triggerTokens,
    hardLimitTokens: policy.hardLimitTokens,
    shouldTrigger,
    shouldForce,
  };
}
