import {
  countTokensForModel,
  countTokensBatchForModel,
  preloadEncoding,
  isEncodingReady,
  MessageTokenCache,
  UsageCalibrator,
} from '../../primitives/tokenizer'

// ============================================================
// Tokenizer 适配层（估算地基）
// ============================================================
// 旧的实现是纯字符级伪 tokenizer（所有函数委托 estimateTokensFromChars）。
// 现改为：精确/近似模型走 js-tiktoken BPE，未知模型回退字符估算，
// 并用 API usage 真值 EMA 校准漂移。见 docs/compaction-redesign.md L0。
//
// 本文件保持原有导出签名（countTokens/countTokensBatch/tokenCounter 等），
// 对外兼容；同时暴露 usage 校准与消息级 tokenCache 的单例，供
// token-counter.ts 与请求组装层（request-budget，L1）使用。

// ── 会话级估算基础设施（按模型分桶 / 带上限，全局单例） ──
const calibrator = new UsageCalibrator()
const tokenCache = new MessageTokenCache()

/**
 * 记录一次 usage 真值样本（prepareStep 估算 vs 下一步 usage.inputTokens 配对）。
 * 供 pipeline/route 在每步请求后调用，喂给校准器。
 */
export function recordUsageSample(
  modelName: string,
  estimatedBaseTokens: number,
  actualInputTokens: number,
): void {
  calibrator.record(modelName, estimatedBaseTokens, actualInputTokens)
}

/** 模型切换时重置校准（词表不同，比率不可迁移） */
export function resetCalibration(modelName: string): void {
  calibrator.reset(modelName)
}

/** 当前模型漂移比率（诊断/日志） */
export function getCalibrationRatio(modelName: string): number {
  return calibrator.getDriftRatio(modelName)
}

/** 估算基础设施单例（供 token-counter 逐消息缓存与校准接入） */
export function getEstimatorInfra(): { calibrator: UsageCalibrator; tokenCache: MessageTokenCache } {
  return { calibrator, tokenCache }
}

// ── 核心计数（接三级引擎） ──
// 计数源头 drift-agnostic（不乘校准系数）——否则与消息级 token 缓存冲突：
// 缓存 key 不含 drift，校准更新后旧缓存永不刷新 → 源头校准基本失效；
// 且若再叠加预算层 tokenizerBuffer 会双重放大。校准统一在 request-budget
// 聚合层应用（totalWithBuffer = base × (1 + driftRatio − 1)），见
// docs/compaction-redesign.md L1。
function estimateTokens(text: string, modelName?: string): number {
  if (!text) return 0
  return countTokensForModel(text, modelName)
}

// ============================================================
// 兼容存根（旧 tokenizer 基础设施面——真实 tokenizer 由 js-tiktoken 承担，
// 无需下载/注册；保留导出避免破坏引用，函数体为 no-op）
// ============================================================
export function registerTokenizer(_modelName: string, _configPath: string): void {}
export function setTokenizerDir(_dir: string): void {}
export function setAutoDownload(_enabled: boolean): void {}

/** 预热常用 encoding（js-tiktoken ranks 加载有成本；会话启动时调用避免首次卡顿） */
export async function preloadTokenizer(modelName?: string): Promise<void> {
  if (modelName) preloadEncoding(modelName)
}

/** 当前模型估算是否就绪；未就绪（encoding 未加载）走字符估算兜底 */
export function isTokenizerReady(modelName?: string): boolean {
  return modelName ? isEncodingReady(modelName) : true
}

export async function hasTokenizerFile(_modelName?: string): Promise<boolean> { return true }
export async function ensureTokenizerAvailable(_modelName: string): Promise<boolean> { return true }
export async function refreshTokenizer(_modelName: string): Promise<void> {}

export async function getTokenizerCacheStatus(_modelName: string): Promise<{
  cached: boolean; cachePath: string | null; size: number | null
}> {
  return { cached: true, cachePath: null, size: null }
}

export function getTokenizerConfig() {
  return { userDir: null, registeredPaths: {}, loadedModels: [], hasFallback: false, autoDownloadEnabled: false }
}

// ============================================================
// 对外计数 API
// ============================================================
export async function countTokens(text: string, modelName?: string): Promise<number> {
  return estimateTokens(text, modelName)
}

export async function countTokensBatch(texts: string[], modelName?: string): Promise<number[]> {
  return countTokensBatchForModel(texts, modelName)
}

export function countTokensSync(text: string, modelName?: string): number {
  return estimateTokens(text, modelName)
}

export function tryCountTokensSync(text: string, modelName?: string): number | null {
  return estimateTokens(text, modelName)
}

export const tokenCounter = {
  count: async (text: string, modelName?: string) => estimateTokens(text, modelName),
  countBatch: async (texts: string[], modelName?: string) =>
    countTokensBatchForModel(texts, modelName),
  countSync: (text: string, modelName?: string) => estimateTokens(text, modelName),
  tryCountSync: (text: string, modelName?: string) => estimateTokens(text, modelName),
  isReady: (_modelName: string) => true,
  getLoadedModels: () => [] as string[],
  hasFallback: () => false,
  getConfig: () => getTokenizerConfig(),
  clearCache: () => { tokenCache.clear(); calibrator.clear() },
}
