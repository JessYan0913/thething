// ============================================================
// Tokenizer Primitive - 估算地基统一入口
// ============================================================
// 三级策略：精确 BPE（GPT）→ 近似 BPE（已知模型族 cl100k）→ 字符估算（未知）
// + 消息级 tokenCache + usage 真值 EMA 校准。见 docs/compaction-redesign.md L0。

export { resolveEncoding, getEncodingLevel, isKnownModel } from './encoding-registry';
export type { EncodingLevel, EncodingResolution } from './encoding-registry';
export {
  countTokensForModel,
  countTokensBatchForModel,
  getEncodingName,
  clearEncodingCache,
  preloadEncoding,
  isEncodingReady,
  PRE_ESTIMATE_CHARS,
  BPE_MAX_CHARS,
} from './tiktoken-engine';
export { MessageTokenCache, cacheFingerprint } from './message-token-cache';
export { UsageCalibrator } from './usage-calibrator';
