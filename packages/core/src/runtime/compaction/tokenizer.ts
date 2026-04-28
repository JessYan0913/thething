// ============================================================
// Tokenizer - 远程加载 + 本地缓存 + 降级机制
// ============================================================
// 支持根据模型名称动态选择对应版本的 tokenizer
// 首次使用时从远程下载到 ~/.cache/thething/tokenizers/
// 后续启动直接使用本地缓存
// 下载失败时自动降级到已缓存的默认 tokenizer
//
// 配置模式：
// 1. 自动缓存模式（默认）: 根据模型名称自动下载并缓存
//    - 缓存目录：~/.cache/thething/tokenizers/{org}_{repo}/
//
// 2. 特定目录模式: setTokenizerDir("...")
//    - 用户手动配置 tokenizer 目录
//    - 跳过自动下载逻辑

import { Tokenizer } from "@huggingface/tokenizers";
import * as path from "path";
import * as fs from "fs/promises";
import { getUserTokenizerCacheDir } from "../../foundation/paths";
import {
  HF_MIRROR_BASE_URL,
  MODEL_TO_HF_REPO_MAPPING,
  DEFAULT_TOKENIZER_REPO,
} from "../../config/defaults";

// ============================================================
// 配置
// ============================================================

/** 用户指定的 tokenizer 目录（手动配置模式） */
let userTokenizerDir: string | null = null;

/** 是否禁用自动下载（用于测试或特殊场景） */
let disableAutoDownload = false;

/** 已警告过的未知模型（避免重复日志） */
const warnedModels = new Set<string>();

// ============================================================
// 模型名称 -> HuggingFace Repo 映射
// ============================================================

interface HfRepoInfo {
  org: string;
  repo: string;
  variant?: string;
}

/**
 * 从模型名称推断 HuggingFace repo 信息
 */
function inferHfRepo(modelName: string): HfRepoInfo {
  const normalized = modelName.toLowerCase();

  // 查找匹配的映射
  for (const [pattern, repoInfo] of Object.entries(MODEL_TO_HF_REPO_MAPPING)) {
    if (normalized.startsWith(pattern) || normalized.includes(pattern)) {
      return repoInfo;
    }
  }

  // 未知模型，使用默认（只警告一次）
  if (!warnedModels.has(modelName)) {
    warnedModels.add(modelName);
    console.warn(`[Tokenizer] 未知模型 "${modelName}", 使用默认 tokenizer (${DEFAULT_TOKENIZER_REPO.org}/${DEFAULT_TOKENIZER_REPO.repo})`);
  }

  return DEFAULT_TOKENIZER_REPO;
}

/**
 * 构建 HuggingFace 下载 URL
 */
function buildHfUrls(repoInfo: HfRepoInfo): { tokenizer: string; config: string } {
  const repoName = repoInfo.variant
    ? `${repoInfo.repo}-${repoInfo.variant}`
    : repoInfo.repo;

  const baseUrl = `${HF_MIRROR_BASE_URL}/${repoInfo.org}/${repoName}/resolve/main`;

  return {
    tokenizer: `${baseUrl}/tokenizer.json`,
    config: `${baseUrl}/tokenizer_config.json`,
  };
}

/**
 * 构建缓存目录名（基于 repo 信息）
 */
function buildCacheDirName(repoInfo: HfRepoInfo): string {
  const repoName = repoInfo.variant
    ? `${repoInfo.repo}-${repoInfo.variant}`
    : repoInfo.repo;

  // 使用 org_repo 格式作为缓存目录名
  return `${repoInfo.org}_${repoName.replace(/-/g, '_')}`;
}

// ============================================================
// Tokenizer 目录查找
// ============================================================

/**
 * 获取 tokenizer 缓存目录
 */
function getTokenizerDir(repoInfo: HfRepoInfo): string {
  // 如果用户手动配置了目录，直接使用
  if (userTokenizerDir) {
    return userTokenizerDir;
  }

  // 使用缓存目录
  const cacheName = buildCacheDirName(repoInfo);
  return getUserTokenizerCacheDir(cacheName);
}

/**
 * 检查 tokenizer 文件是否存在
 */
async function checkTokenizerFilesExist(dir: string): Promise<boolean> {
  const tokenizerPath = path.join(dir, "tokenizer.json");
  try {
    await fs.access(tokenizerPath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 远程下载
// ============================================================

/**
 * 从远程下载 tokenizer 文件
 */
async function downloadTokenizerFiles(repoInfo: HfRepoInfo, destDir: string): Promise<void> {
  const urls = buildHfUrls(repoInfo);

  // 确保目标目录存在
  await fs.mkdir(destDir, { recursive: true });

  const repoName = repoInfo.variant
    ? `${repoInfo.repo}-${repoInfo.variant}`
    : repoInfo.repo;

  console.log(`[Tokenizer] 开始下载 ${repoInfo.org}/${repoName} tokenizer...`);

  // 下载 tokenizer.json
  const tokenizerDest = path.join(destDir, "tokenizer.json");
  await downloadFile(urls.tokenizer, tokenizerDest);
  console.log(`[Tokenizer] ✅ tokenizer.json 已下载`);

  // 下载 tokenizer_config.json（可选）
  const configDest = path.join(destDir, "tokenizer_config.json");
  try {
    await downloadFile(urls.config, configDest);
    console.log(`[Tokenizer] ✅ tokenizer_config.json 已下载`);
  } catch {
    // config 文件可选，忽略错误
    console.log(`[Tokenizer] ⚠️ tokenizer_config.json 不存在，跳过`);
  }
}

/**
 * 下载单个文件（带超时和错误处理）
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60000), // 60秒超时
    });

    if (!response.ok) {
      throw new Error(`状态码 ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(buffer));
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`下载超时`);
    }
    throw error;
  }
}

// ============================================================
// Tokenizer 实例缓存
// ============================================================

/** Tokenizer 实例缓存 */
const tokenizerCache: Map<string, Tokenizer> = new Map();

/** 默认 tokenizer 实例（用于降级） */
let defaultTokenizer: Tokenizer | null = null;

/** 加载错误缓存 */
const loadErrorCache: Map<string, Error> = new Map();

/** 正在下载的任务（避免重复下载） */
const downloadingTasks: Map<string, Promise<void>> = new Map();

/**
 * 加载 tokenizer（自动下载，失败时降级）
 */
async function loadTokenizer(modelName: string): Promise<Tokenizer> {
  const repoInfo = inferHfRepo(modelName);
  const cacheKey = userTokenizerDir ? "user-dir" : buildCacheDirName(repoInfo);

  // 检查缓存
  const cached = tokenizerCache.get(cacheKey);
  if (cached) return cached;

  const tokenizerDir = getTokenizerDir(repoInfo);

  // 检查文件是否存在
  const filesExist = await checkTokenizerFilesExist(tokenizerDir);

  // 如果文件不存在且未禁用自动下载
  if (!filesExist && !disableAutoDownload && !userTokenizerDir) {
    // 检查是否正在下载（避免重复下载）
    const existingTask = downloadingTasks.get(cacheKey);
    if (existingTask) {
      try {
        await existingTask;
      } catch {
        // 下载失败，后续会降级
      }
    } else {
      // 开始下载
      const downloadPromise = downloadTokenizerFiles(repoInfo, tokenizerDir)
        .catch((downloadError) => {
          console.error(`[Tokenizer] ❌ 下载失败: ${downloadError instanceof Error ? downloadError.message : downloadError}`);
          throw downloadError;
        });

      downloadingTasks.set(cacheKey, downloadPromise);

      try {
        await downloadPromise;
      } catch {
        downloadingTasks.delete(cacheKey);
        // 下载失败，将使用降级机制
      }
    }
  }

  // 尝试加载 tokenizer
  const tokenizerJsonPath = path.join(tokenizerDir, "tokenizer.json");
  const tokenizerConfigPath = path.join(tokenizerDir, "tokenizer_config.json");

  try {
    const tokenizerJsonContent = await fs.readFile(tokenizerJsonPath, "utf-8");
    const tokenizerJson = JSON.parse(tokenizerJsonContent);

    let tokenizerConfig = {};
    try {
      const configContent = await fs.readFile(tokenizerConfigPath, "utf-8");
      tokenizerConfig = JSON.parse(configContent);
    } catch {
      // config 文件可选
    }

    const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
    tokenizerCache.set(cacheKey, tokenizer);

    const sourceInfo = userTokenizerDir
      ? `用户配置目录`
      : `缓存目录`;

    console.log(`[Tokenizer] ✅ 已加载 ${modelName} (${sourceInfo}: ${tokenizerDir})`);
    return tokenizer;
  } catch {
    // 加载失败，尝试使用默认 tokenizer 降级
    return fallbackToDefaultTokenizer(modelName, repoInfo);
  }
}

/**
 * 降级到默认 tokenizer
 */
async function fallbackToDefaultTokenizer(modelName: string, failedRepoInfo: HfRepoInfo): Promise<Tokenizer> {
  // 如果已有默认 tokenizer 实例，直接使用
  if (defaultTokenizer) {
    console.log(`[Tokenizer] ⚠️ ${modelName} tokenizer 加载失败，降级使用默认 tokenizer`);
    return defaultTokenizer;
  }

  // 尝试加载默认 tokenizer
  const defaultDir = getTokenizerDir(DEFAULT_TOKENIZER_REPO);
  const defaultCacheKey = buildCacheDirName(DEFAULT_TOKENIZER_REPO);

  // 检查默认 tokenizer 是否已缓存
  const defaultExists = await checkTokenizerFilesExist(defaultDir);

  if (!defaultExists && !disableAutoDownload) {
    // 尝试下载默认 tokenizer
    try {
      await downloadTokenizerFiles(DEFAULT_TOKENIZER_REPO, defaultDir);
    } catch (downloadError) {
      console.error(`[Tokenizer] ❌ 默认 tokenizer 下载也失败: ${downloadError instanceof Error ? downloadError.message : downloadError}`);
      throw new Error(
        `Tokenizer 加载失败，无法降级\n` +
        `原始模型: ${modelName} (${failedRepoInfo.org}/${failedRepoInfo.repo})\n` +
        `默认模型: ${DEFAULT_TOKENIZER_REPO.org}/${DEFAULT_TOKENIZER_REPO.repo}\n` +
        `解决方案:\n` +
        `  1. 检查网络连接\n` +
        `  2. 手动下载 tokenizer 到 ~/.cache/thething/tokenizers/${buildCacheDirName(DEFAULT_TOKENIZER_REPO)}/\n` +
        `  3. 或调用 setTokenizerDir('/path/to/dir') 配置本地目录`
      );
    }
  }

  // 加载默认 tokenizer
  const defaultTokenizerPath = path.join(defaultDir, "tokenizer.json");
  const defaultConfigPath = path.join(defaultDir, "tokenizer_config.json");

  try {
    const tokenizerJsonContent = await fs.readFile(defaultTokenizerPath, "utf-8");
    const tokenizerJson = JSON.parse(tokenizerJsonContent);

    let tokenizerConfig = {};
    try {
      const configContent = await fs.readFile(defaultConfigPath, "utf-8");
      tokenizerConfig = JSON.parse(configContent);
    } catch {
      // config 文件可选
    }

    defaultTokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
    tokenizerCache.set(defaultCacheKey, defaultTokenizer);

    console.log(`[Tokenizer] ⚠️ ${modelName} tokenizer 加载失败，降级使用 ${DEFAULT_TOKENIZER_REPO.org}/${DEFAULT_TOKENIZER_REPO.repo}`);
    return defaultTokenizer;
  } catch (loadError) {
    throw new Error(
      `Tokenizer 加载失败\n` +
      `原始模型: ${modelName}\n` +
      `默认模型也无法加载: ${loadError instanceof Error ? loadError.message : loadError}`
    );
  }
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 设置 tokenizer 目录（手动配置模式）
 */
export function setTokenizerDir(dir: string): void {
  userTokenizerDir = dir;
  console.log(`[Tokenizer] 配置手动目录: ${dir}（跳过自动下载）`);

  // 重置缓存
  tokenizerCache.clear();
  loadErrorCache.clear();
  warnedModels.clear();
  defaultTokenizer = null;
}

/**
 * 预加载 tokenizer（应用启动时调用）
 */
export async function preloadTokenizer(modelName?: string): Promise<void> {
  const model = modelName || "qwen-plus";

  try {
    await loadTokenizer(model);
    console.log(`[Tokenizer] 预加载完成 (${model})`);
  } catch (error) {
    console.error("[Tokenizer] 预加载失败:", error instanceof Error ? error.message : error);
  }
}

/**
 * 检查 tokenizer 是否已加载
 */
export function isTokenizerReady(modelName?: string): boolean {
  const repoInfo = inferHfRepo(modelName || "qwen-plus");
  const cacheKey = userTokenizerDir ? "user-dir" : buildCacheDirName(repoInfo);
  return tokenizerCache.has(cacheKey) || defaultTokenizer !== null;
}

/**
 * 检查 tokenizer 缓存文件是否存在
 */
export async function hasTokenizerFile(modelName?: string): Promise<boolean> {
  const repoInfo = inferHfRepo(modelName || "qwen-plus");
  const dir = getTokenizerDir(repoInfo);
  return checkTokenizerFilesExist(dir);
}

/**
 * 确保 tokenizer 可用（检查缓存或下载）
 */
export async function ensureTokenizerAvailable(modelName: string): Promise<boolean> {
  const repoInfo = inferHfRepo(modelName);
  const dir = getTokenizerDir(repoInfo);

  if (userTokenizerDir) {
    return checkTokenizerFilesExist(dir);
  }

  const cached = await checkTokenizerFilesExist(dir);
  if (cached) return true;

  if (!disableAutoDownload) {
    try {
      await downloadTokenizerFiles(repoInfo, dir);
      return true;
    } catch {
      // 尝试默认 tokenizer
      const defaultDir = getTokenizerDir(DEFAULT_TOKENIZER_REPO);
      const defaultExists = await checkTokenizerFilesExist(defaultDir);
      if (defaultExists) return true;

      try {
        await downloadTokenizerFiles(DEFAULT_TOKENIZER_REPO, defaultDir);
        return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}

/**
 * 强制重新下载 tokenizer（更新缓存）
 */
export async function refreshTokenizer(modelName: string): Promise<void> {
  const repoInfo = inferHfRepo(modelName);
  const cacheKey = userTokenizerDir ? "user-dir" : buildCacheDirName(repoInfo);
  const dir = getTokenizerDir(repoInfo);

  // 清除缓存
  tokenizerCache.delete(cacheKey);
  loadErrorCache.delete(cacheKey);

  // 重新下载
  await downloadTokenizerFiles(repoInfo, dir);

  console.log(`[Tokenizer] ✅ 已刷新 ${modelName} tokenizer`);
}

/**
 * 获取 tokenizer 缓存状态
 */
export async function getTokenizerCacheStatus(modelName: string): Promise<{
  cached: boolean;
  cachePath: string | null;
  size: number | null;
}> {
  const repoInfo = inferHfRepo(modelName);
  const dir = getTokenizerDir(repoInfo);

  try {
    const tokenizerStats = await fs.stat(path.join(dir, "tokenizer.json"));
    let totalSize = tokenizerStats.size;

    try {
      const configStats = await fs.stat(path.join(dir, "tokenizer_config.json"));
      totalSize += configStats.size;
    } catch {
      // config 文件可选
    }

    return {
      cached: true,
      cachePath: dir,
      size: totalSize,
    };
  } catch {
    return {
      cached: false,
      cachePath: dir,
      size: null,
    };
  }
}

/**
 * 获取当前配置信息（用于调试）
 */
export function getTokenizerConfig(): {
  userDir: string | null;
  cacheDir: string;
  loadedModels: string[];
  isAutoDownloadEnabled: boolean;
  hasFallback: boolean;
} {
  return {
    userDir: userTokenizerDir,
    cacheDir: getUserTokenizerCacheDir(),
    loadedModels: Array.from(tokenizerCache.keys()),
    isAutoDownloadEnabled: !disableAutoDownload,
    hasFallback: defaultTokenizer !== null,
  };
}

/**
 * 禁用/启用自动下载（用于测试）
 */
export function setAutoDownload(enabled: boolean): void {
  disableAutoDownload = !enabled;
}

// ============================================================
// Token 计算
// ============================================================

/**
 * 计算文本的 token 数量
 */
export async function countTokens(text: string, modelName?: string): Promise<number> {
  if (!text) return 0;

  const tokenizer = await loadTokenizer(modelName || "qwen-plus");
  return tokenizer.encode(text).ids.length;
}

/**
 * 批量计算 token 数量
 */
export async function countTokensBatch(texts: string[], modelName?: string): Promise<number[]> {
  if (!texts || texts.length === 0) return [];

  const tokenizer = await loadTokenizer(modelName || "qwen-plus");
  return texts.map((text) => {
    if (!text) return 0;
    return tokenizer.encode(text).ids.length;
  });
}

/**
 * 同步计算 token 数量（使用已加载的 tokenizer）
 */
export function countTokensSync(text: string, modelName?: string): number {
  if (!text) return 0;

  const repoInfo = inferHfRepo(modelName || "qwen-plus");
  const cacheKey = userTokenizerDir ? "user-dir" : buildCacheDirName(repoInfo);

  const tokenizer = tokenizerCache.get(cacheKey) || defaultTokenizer;
  if (!tokenizer) {
    throw new Error(`Tokenizer 未加载，请先调用 preloadTokenizer()`);
  }

  return tokenizer.encode(text).ids.length;
}

/**
 * 尝试同步计算（如果已加载）
 */
export function tryCountTokensSync(text: string, modelName?: string): number | null {
  if (!text) return 0;

  const repoInfo = inferHfRepo(modelName || "qwen-plus");
  const cacheKey = userTokenizerDir ? "user-dir" : buildCacheDirName(repoInfo);

  const tokenizer = tokenizerCache.get(cacheKey) || defaultTokenizer;
  if (!tokenizer) return null;

  return tokenizer.encode(text).ids.length;
}

// 导出 inferHfRepo 用于 token-counter.ts
export { inferHfRepo, buildHfUrls };