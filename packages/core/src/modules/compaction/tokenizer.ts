import { estimateTokensFromChars } from '../../primitives/token-estimate'

function estimateTokens(text: string): number {
  if (!text) return 0
  // 统一走 CJK 校准的字符级估算(见 docs/context-compaction-analysis.md #5)
  return estimateTokensFromChars(text)
}

export function registerTokenizer(_modelName: string, _configPath: string): void {}
export function setTokenizerDir(_dir: string): void {}
export function setAutoDownload(_enabled: boolean): void {}
export async function preloadTokenizer(_modelName?: string): Promise<void> {}
export function isTokenizerReady(_modelName?: string): boolean { return true }
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

export async function countTokens(text: string, _modelName?: string): Promise<number> {
  return estimateTokens(text)
}

export async function countTokensBatch(texts: string[], _modelName?: string): Promise<number[]> {
  return texts.map(estimateTokens)
}

export function countTokensSync(text: string, _modelName?: string): number {
  return estimateTokens(text)
}

export function tryCountTokensSync(text: string, _modelName?: string): number | null {
  return estimateTokens(text)
}

export const tokenCounter = {
  count: async (text: string, _modelName: string) => estimateTokens(text),
  countBatch: async (texts: string[], _modelName: string) => texts.map(estimateTokens),
  countSync: (text: string, _modelName: string) => estimateTokens(text),
  tryCountSync: (text: string, _modelName: string) => estimateTokens(text),
  isReady: (_modelName: string) => true,
  getLoadedModels: () => [] as string[],
  hasFallback: () => false,
  getConfig: () => getTokenizerConfig(),
  clearCache: () => {},
}
