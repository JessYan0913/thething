// ============================================================
// Tiktoken Engine - js-tiktoken 精确计数包装
// ============================================================
// 估算地基（见 docs/compaction-redesign.md L0）：
// - 精确/近似模型 → js-tiktoken BPE 精确计数（encoding 懒加载 + 全局缓存）
// - 未知模型 → 回退 primitives/token-estimate 字符估算（带 usage 校准）
//
// 性能防护（重要——js-tiktoken 的 BPE 对高重复文本存在 O(n²) 病态退化：
// 'x'.repeat(50000) 编码实测 171s，'x'*20000 也要 25s，分段无效）。
// 因此不是所有文本都适合走 BPE，防护策略：
//   1. 小文本（< 1000 chars）→ 字符估算（省 tiktoken 调用）
//   2. 高重复文本（前 100 字符块出现在中段+尾段）→ 字符估算（拦截 O(n²) 病态）
//   3. 超长文本（> 20k chars）→ 字符估算（控制最坏时间）
//   4. 其余 → BPE 精确
// 字符估算在量级上正确，系统性偏差交给 usage-calibrator 收敛。
//
// 预热：preloadEncoding 在会话启动时预加载常用 encoding，避免首次压缩卡顿。

import { Tiktoken, TiktokenEncoding, getEncoding } from 'js-tiktoken';
import { estimateTokensFromChars } from '../token-estimate';
import { resolveEncoding } from './encoding-registry';

/** 小文本启发式预检阈值：低于此长度直接字符估算（省 tiktoken 调用） */
export const PRE_ESTIMATE_CHARS = 1000;
/** BPE 长度上限：超过此长度不直接全量 BPE（控制 O(n²) 病态退化的最坏时间） */
export const BPE_MAX_CHARS = 20_000;

/** 全局 encoding 实例缓存（懒加载，跨会话复用） */
const encodingCache = new Map<string, Tiktoken>();

function getEncodingInstance(encoding: string): Tiktoken {
  let enc = encodingCache.get(encoding);
  if (!enc) {
    enc = getEncoding(encoding as TiktokenEncoding);
    encodingCache.set(encoding, enc);
  }
  return enc;
}

/**
 * 高重复检测：前 100 字符块是否同时出现在中段与尾段（完全相同 → 高重复）。
 * 拦截 BPE 的 O(n²) 病态退化（单字符/单行重复的文本）。
 */
function isHighlyRepeated(text: string): boolean {
  if (text.length < 2000) return false;
  const chunk = text.slice(0, 100);
  if (text.slice(Math.floor(text.length / 2), Math.floor(text.length / 2) + 100) !== chunk) return false;
  if (text.slice(-100) !== chunk) return false;
  return true;
}

/** 是否走字符估算（不满足 BPE 精确条件时） */
function shouldUseCharEstimate(text: string): boolean {
  return (
    text.length < PRE_ESTIMATE_CHARS ||
    text.length > BPE_MAX_CHARS ||
    isHighlyRepeated(text)
  );
}

/**
 * 精确计数文本 token（BPE 或字符回退）。
 *
 * @param text 待计数文本
 * @param modelName 模型名（决定 encoding；undefined/null 走字符估算）
 * @param calibration usage 校准系数（仅作用于字符估算路径；BPE 路径忽略，
 *   其系统性偏差由预算层 tokenizerBuffer 修正）
 */
export function countTokensForModel(
  text: string,
  modelName?: string,
  calibration = 1,
): number {
  if (!text) return 0;
  const { level, encoding } = resolveEncoding(modelName);
  if (level !== 'char' && encoding && !shouldUseCharEstimate(text)) {
    return getEncodingInstance(encoding).encode(text).length;
  }
  return estimateTokensFromChars(text, calibration);
}

/**
 * 批量精确计数（复用同一 encoding 实例）。
 * 上层估算多条消息文本时避免反复 resolveEncoding。
 */
export function countTokensBatchForModel(
  texts: string[],
  modelName?: string,
  calibration = 1,
): number[] {
  const { level, encoding } = resolveEncoding(modelName);
  if (level !== 'char' && encoding) {
    const enc = getEncodingInstance(encoding);
    return texts.map((t) =>
      t && !shouldUseCharEstimate(t) ? enc.encode(t).length : estimateTokensFromChars(t, calibration),
    );
  }
  return texts.map((t) => estimateTokensFromChars(t, calibration));
}

/**
 * 预热常用 encoding（会话启动时调用）。
 * js-tiktoken 的 ranks 表较大（cl100k 约 1.5MB+），首次 getEncoding 有可观
 * 加载时间——预热避免首次压缩步骤卡顿。
 */
export function preloadEncoding(modelName: string): boolean {
  const { level, encoding } = resolveEncoding(modelName);
  if (level !== 'char' && encoding) {
    try {
      getEncodingInstance(encoding);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** 当前模型估算是否就绪（encoding 可解析且已加载；未就绪走字符估算兜底） */
export function isEncodingReady(modelName: string): boolean {
  const { level, encoding } = resolveEncoding(modelName);
  return level !== 'char' && !!encoding && encodingCache.has(encoding);
}

/** 测试/诊断：查看模型命中的 encoding 名 */
export function getEncodingName(modelName?: string): string | null {
  return resolveEncoding(modelName).encoding;
}

/** 清除 encoding 缓存（测试隔离用） */
export function clearEncodingCache(): void {
  encodingCache.clear();
}
