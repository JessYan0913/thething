// ============================================================
// Usage Calibrator - API usage 真值 EMA 漂移校准
// ============================================================
// 估算地基（见 docs/compaction-redesign.md L0）：
// 本地估算（cl100k 近似 Qwen/DeepSeek 等 / 未知模型字符估算）与 provider 真实
// 计数存在系统性偏差，静态 buffer 是"拍脑袋"。解法：每步 API 返回的
// usage.inputTokens 是免费真值信号，用它 EMA 校准 driftRatio；预算层用它
// 推导 tokenizerBuffer（见 compaction-redesign L1）。
//
// 稳健性：
// - 异常样本拒绝：比率 <0.5 或 >3 丢弃（中途插入了未估算内容，无校准价值）
// - clamp [0.85, 1.6]：连续异常样本也不会把预算拖到危险区间
// - 模型切换重置：词表不同，比率不可迁移
// - 冷启动 = 1（预算层静态 buffer 兜底）；首样本直接采用

interface CalibrationEntry {
  ratio: number;
  samples: number;
}

const ALPHA = 0.3;
const MIN_ACCEPT = 0.5;
const MAX_ACCEPT = 3;
const CLAMP_MIN = 0.85;
const CLAMP_MAX = 1.6;

export class UsageCalibrator {
  private entries = new Map<string, CalibrationEntry>();

  /**
   * 记录一次 usage 真值样本（估算与真实 input tokens 同时已知）。
   *
   * @param modelName 模型名（按模型分桶，词表不同不可迁移）
   * @param estimatedBaseTokens 本地估算的请求输入 token（messages+instructions+tools，不含 outputReserve）
   * @param actualInputTokens provider 返回的 usage.inputTokens 真值
   */
  record(modelName: string, estimatedBaseTokens: number, actualInputTokens: number): void {
    if (!(estimatedBaseTokens > 0) || !(actualInputTokens > 0)) return;

    const sample = actualInputTokens / estimatedBaseTokens;
    // 异常样本拒绝：比率极端说明估算基准与本次请求不对应
    if (sample < MIN_ACCEPT || sample > MAX_ACCEPT) return;

    const entry = this.entries.get(modelName) ?? { ratio: 1, samples: 0 };
    if (entry.samples === 0) {
      // 首样本直接采用（冷启动，clamp 防尖峰）
      entry.ratio = clamp(sample);
    } else {
      entry.ratio = clamp(ALPHA * sample + (1 - ALPHA) * entry.ratio);
    }
    entry.samples++;
    this.entries.set(modelName, entry);
  }

  /** 模型切换时重置（词表不同，历史比率不可迁移） */
  reset(modelName: string): void {
    this.entries.delete(modelName);
  }

  /** 当前漂移比率（冷启动返回 1） */
  getDriftRatio(modelName: string): number {
    return this.entries.get(modelName)?.ratio ?? 1;
  }

  /** tokenizerBuffer 比率 = driftRatio − 1（冷启动 0，即不额外 buffer） */
  getTokenizerBufferRatio(modelName: string): number {
    return (this.entries.get(modelName)?.ratio ?? 1) - 1;
  }

  /** 已积累样本数（诊断用） */
  getSamples(modelName: string): number {
    return this.entries.get(modelName)?.samples ?? 0;
  }

  clear(): void {
    this.entries.clear();
  }
}

function clamp(v: number): number {
  return Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, v));
}
