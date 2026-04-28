// ============================================================
// Tokenizer - 使用 @huggingface/tokenizers 进行精确 Token 计算
// ============================================================
// 支持根据模型名称动态选择对应版本的 tokenizer
// 需要本地 tokenizer.json 和 tokenizer_config.json 文件
//
// 配置模式：
// 1. 基础目录模式（推荐）: setTokenizerBaseDir(".../assets/models")
//    - 目录包含多个版本子目录：qwen2.5/, qwen3.5/
//    - 根据模型名称自动选择版本
//
// 2. 特定版本模式: setTokenizerVersionDir(".../assets/models/qwen2.5")
//    - 目录直接包含 tokenizer.json
//    - 强制使用该版本，忽略模型名称选择

import { Tokenizer } from "@huggingface/tokenizers";
import * as path from "path";
import * as fs from "fs";

// ============================================================
// 配置
// ============================================================

/** Tokenizer 基础目录（包含多版本子目录） */
let tokenizerBaseDir: string | null = null;

/** 用户指定的特定版本目录（直接包含 tokenizer.json） */
let userVersionDir: string | null = null;

/** 默认 tokenizer 版本（当无法推断模型版本时使用） */
const DEFAULT_TOKENIZER_VERSION = "qwen2.5";

/** 支持的 tokenizer 版本列表 */
const SUPPORTED_VERSIONS = ["qwen2.5", "qwen3.5"];

// ============================================================
// 模型名称 -> Tokenizer 版本映射
// ============================================================

/**
 * 从模型名称推断 tokenizer 版本
 *
 * @example
 *   "qwen3.5-397b-a17b" -> "qwen3.5"
 *   "qwen2.5-7b-instruct" -> "qwen2.5"
 *   "qwen-max" -> "qwen3.5" (使用最新版本)
 *   "qwen-plus" -> "qwen2.5"
 */
function inferTokenizerVersion(modelName: string): string {
  const normalized = modelName.toLowerCase();

  // 直接匹配版本号
  for (const version of SUPPORTED_VERSIONS) {
    if (normalized.startsWith(version)) {
      return version;
    }
  }

  // 特殊模型映射
  if (normalized.includes("qwen-max") || normalized.includes("qwen3")) {
    return "qwen3.5"; // 高端模型使用最新 tokenizer
  }

  if (normalized.includes("qwen-plus") || normalized.includes("qwen-turbo")) {
    return "qwen2.5"; // 中端模型使用稳定版本
  }

  // 未知模型，使用默认版本
  console.warn(`[Tokenizer] 未知模型 "${modelName}", 使用默认版本 ${DEFAULT_TOKENIZER_VERSION}`);
  return DEFAULT_TOKENIZER_VERSION;
}

// ============================================================
// Tokenizer 目录查找
// ============================================================

/**
 * 自动检测 tokenizer 基础目录
 */
function autoDetectBaseDir(): string | null {
  const possiblePaths = [
    // 开发环境: 相对于编译后的 dist 目录
    path.join(__dirname, "..", "..", "..", "assets", "models"),
    // 源码环境: 直接相对于源码目录
    path.join(__dirname, "..", "..", "assets", "models"),
    // Next.js 打包环境: 相对于项目根目录
    path.join(process.cwd(), "packages", "core", "assets", "models"),
    // Monorepo 子应用环境（如 apps/sime-agent）
    path.join(process.cwd(), "..", "..", "packages", "core", "assets", "models"),
  ];

  for (const dir of possiblePaths) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }

  return null;
}

/**
 * 检测目录是基础目录还是特定版本目录
 * @returns "base" | "version" | null
 */
function detectDirType(dir: string): "base" | "version" | null {
  // 如果直接包含 tokenizer.json，是特定版本目录
  if (fs.existsSync(path.join(dir, "tokenizer.json"))) {
    return "version";
  }

  // 如果包含版本子目录（如 qwen2.5/tokenizer.json），是基础目录
  for (const version of SUPPORTED_VERSIONS) {
    if (fs.existsSync(path.join(dir, version, "tokenizer.json"))) {
      return "base";
    }
  }

  return null;
}

/**
 * 获取指定版本的 tokenizer 目录
 *
 * 优先级：
 * 1. 用户指定的特定版本目录（忽略版本参数）
 * 2. 用户指定的基础目录 + 版本子目录
 * 3. 自动检测的基础目录 + 版本子目录
 */
function getTokenizerDir(version: string): string | null {
  // 如果用户指定了特定版本目录，直接使用（忽略版本选择）
  if (userVersionDir) {
    return userVersionDir;
  }

  // 获取基础目录
  const baseDir = tokenizerBaseDir || autoDetectBaseDir();
  if (!baseDir) return null;

  // 在基础目录下查找版本子目录
  const versionDir = path.join(baseDir, version);
  if (fs.existsSync(path.join(versionDir, "tokenizer.json"))) {
    return versionDir;
  }

  return null;
}

// ============================================================
// Tokenizer 实例缓存
// ============================================================

/** Tokenizer 实例缓存（按版本） */
const tokenizerCache: Map<string, Tokenizer> = new Map();

/** 加载错误缓存（按版本） */
const loadErrorCache: Map<string, Error> = new Map();

/**
 * 加载指定版本的 tokenizer
 */
function loadTokenizerByVersion(version: string): Tokenizer {
  // 如果用户指定了特定版本目录，使用统一的缓存 key
  const cacheKey = userVersionDir ? "user-version" : version;

  // 检查缓存
  const cached = tokenizerCache.get(cacheKey);
  if (cached) return cached;

  // 检查已记录的错误
  const cachedError = loadErrorCache.get(cacheKey);
  if (cachedError) throw cachedError;

  // 查找 tokenizer 目录
  const tokenizerDir = getTokenizerDir(version);
  if (!tokenizerDir) {
    const error = createNotFoundError(version);
    loadErrorCache.set(cacheKey, error);
    throw error;
  }

  const tokenizerJsonPath = path.join(tokenizerDir, "tokenizer.json");
  const tokenizerConfigPath = path.join(tokenizerDir, "tokenizer_config.json");

  try {
    const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerJsonPath, "utf-8"));
    let tokenizerConfig = {};
    if (fs.existsSync(tokenizerConfigPath)) {
      tokenizerConfig = JSON.parse(fs.readFileSync(tokenizerConfigPath, "utf-8"));
    }

    const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
    tokenizerCache.set(cacheKey, tokenizer);

    const versionInfo = userVersionDir
      ? `用户配置目录`
      : `版本 ${version}`;
    console.log(`[Tokenizer] ✅ 已加载 ${versionInfo}: ${tokenizerJsonPath}`);
    return tokenizer;
  } catch (error) {
    const loadError = new Error(`Tokenizer 加载失败: ${error}`);
    loadErrorCache.set(cacheKey, loadError);
    throw loadError;
  }
}

/**
 * 创建"未找到"错误
 */
function createNotFoundError(requestedVersion: string): Error {
  const baseDir = tokenizerBaseDir || autoDetectBaseDir();
  const searchedPaths = baseDir
    ? [path.join(baseDir, requestedVersion, "tokenizer.json")]
    : [
      path.join(__dirname, "..", "..", "..", "assets", "models", requestedVersion, "tokenizer.json"),
      path.join(__dirname, "..", "..", "assets", "models", requestedVersion, "tokenizer.json"),
      path.join(process.cwd(), "packages", "core", "assets", "models", requestedVersion, "tokenizer.json"),
    ];

  return new Error(
    `tokenizer 不存在 (版本: ${requestedVersion})\n` +
    `解决方案:\n` +
    `  1. 调用 setTokenizerBaseDir('/path/to/assets/models') 配置基础目录\n` +
    `     （支持根据模型名称自动选择版本）\n` +
    `  2. 或调用 setTokenizerVersionDir('/path/to/qwen2.5') 配置特定版本\n` +
    `     （强制使用指定版本）\n` +
    `  3. 或下载 tokenizer 到 packages/core/assets/models/${requestedVersion}/\n` +
    `     https://huggingface.co/Qwen/${requestedVersion}-7B-Instruct\n` +
    `已搜索路径:\n${searchedPaths.map(p => `  - ${p}`).join("\n")}`
  );
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 设置 tokenizer 目录（自动检测类型）
 *
 * 自动检测逻辑：
 * - 如果目录直接包含 tokenizer.json → 特定版本模式（强制使用该版本）
 * - 如果目录包含版本子目录（qwen2.5/、qwen3.5/）→ 基础目录模式（支持动态选择）
 *
 * @example
 * // 基础目录模式（支持动态选择）
 * setTokenizerDir("E:/ai-chatbot/packages/core/assets/models")
 *
 * // 特定版本模式（强制使用该版本）
 * setTokenizerDir("E:/ai-chatbot/packages/core/assets/models/qwen2.5")
 */
export function setTokenizerDir(dir: string): void {
  const dirType = detectDirType(dir);

  if (dirType === "version") {
    // 特定版本目录：强制使用该版本
    userVersionDir = dir;
    tokenizerBaseDir = path.dirname(dir);
    console.log(`[Tokenizer] 配置特定版本目录: ${dir}（强制使用）`);
  } else if (dirType === "base") {
    // 基础目录：支持动态选择
    tokenizerBaseDir = dir;
    userVersionDir = null;
    console.log(`[Tokenizer] 配置基础目录: ${dir}（支持动态选择）`);
  } else {
    // 目录无效，记录配置（可能在后续下载后生效）
    tokenizerBaseDir = dir;
    userVersionDir = null;
    console.warn(`[Tokenizer] 目录无效: ${dir}（未找到 tokenizer 文件）`);
  }

  // 重置缓存
  tokenizerCache.clear();
  loadErrorCache.clear();
}

/**
 * 预加载 tokenizer（应用启动时调用）
 * 可指定模型名称，或加载默认版本
 *
 * @param modelName 模型名称，用于推断版本
 */
export async function preloadTokenizer(modelName?: string): Promise<void> {
  const version = modelName
    ? inferTokenizerVersion(modelName)
    : DEFAULT_TOKENIZER_VERSION;

  try {
    loadTokenizerByVersion(version);
    console.log(`[Tokenizer] 预加载完成 (${userVersionDir ? '用户配置' : version})`);
  } catch (error) {
    console.error("[Tokenizer] 预加载失败:", error instanceof Error ? error.message : error);
  }
}

/**
 * 检查 tokenizer 是否已加载
 */
export function isTokenizerReady(version?: string): boolean {
  const cacheKey = userVersionDir ? "user-version" : (version || DEFAULT_TOKENIZER_VERSION);
  return tokenizerCache.has(cacheKey);
}

/**
 * 检查 tokenizer 文件是否存在
 */
export function hasTokenizerFile(version?: string): boolean {
  const v = version || DEFAULT_TOKENIZER_VERSION;
  return getTokenizerDir(v) !== null;
}

/**
 * 获取当前配置信息（用于调试）
 */
export function getTokenizerConfig(): {
  baseDir: string | null;
  versionDir: string | null;
  loadedVersions: string[];
  isDynamicSelection: boolean;
} {
  return {
    baseDir: tokenizerBaseDir || autoDetectBaseDir(),
    versionDir: userVersionDir,
    loadedVersions: Array.from(tokenizerCache.keys()),
    isDynamicSelection: !userVersionDir, // 有特定版本目录时禁用动态选择
  };
}

// ============================================================
// Token 计算
// ============================================================

/**
 * 计算文本的 token 数量（支持指定模型）
 *
 * @param text 要计算的文本
 * @param modelName 模型名称，用于推断 tokenizer 版本
 */
export async function countTokens(text: string, modelName?: string): Promise<number> {
  if (!text) return 0;

  const version = modelName
    ? inferTokenizerVersion(modelName)
    : DEFAULT_TOKENIZER_VERSION;

  const tokenizer = loadTokenizerByVersion(version);
  return tokenizer.encode(text).ids.length;
}

/**
 * 批量计算 token 数量（支持指定模型）
 */
export async function countTokensBatch(texts: string[], modelName?: string): Promise<number[]> {
  if (!texts || texts.length === 0) return [];

  const version = modelName
    ? inferTokenizerVersion(modelName)
    : DEFAULT_TOKENIZER_VERSION;

  const tokenizer = loadTokenizerByVersion(version);
  return texts.map((text) => {
    if (!text) return 0;
    return tokenizer.encode(text).ids.length;
  });
}

/**
 * 同步计算 token 数量（使用已加载的 tokenizer）
 */
export function countTokensSync(text: string, version?: string): number {
  if (!text) return 0;

  const cacheKey = userVersionDir ? "user-version" : (version || DEFAULT_TOKENIZER_VERSION);
  const tokenizer = tokenizerCache.get(cacheKey);

  if (!tokenizer) {
    throw new Error(`Tokenizer 未加载，请先调用 preloadTokenizer()`);
  }

  return tokenizer.encode(text).ids.length;
}

/**
 * 尝试同步计算（如果已加载）
 */
export function tryCountTokensSync(text: string, version?: string): number | null {
  if (!text) return 0;

  const cacheKey = userVersionDir ? "user-version" : (version || DEFAULT_TOKENIZER_VERSION);
  const tokenizer = tokenizerCache.get(cacheKey);

  if (!tokenizer) return null;
  return tokenizer.encode(text).ids.length;
}