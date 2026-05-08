// ============================================================
// Tokenizer - 精确 Token 计算
// ============================================================
// 使用 @huggingface/tokenizers 进行精确 Token 计算
// 支持三种配置方式：
//
// 1. 自动下载模式（默认）
//    - 根据模型名称自动从 HuggingFace CDN 下载
//    - 缓存到 ~/.cache/thething/tokenizers/
//
// 2. 手动路径模式
//    - 用户指定本地 tokenizer.json 文件路径
//    - 调用 registerTokenizer('qwen', '/path/to/tokenizer.json')
//
// 3. 目录模式
//    - 用户指定包含 tokenizer 文件的目录
//    - 调用 setTokenizerDir('/path/to/tokenizers/')
//
// 降级机制：下载失败时自动使用默认 tokenizer

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
// TokenCounter - 核心 Token 管理类
// ============================================================

class TokenCounterImpl {
  /** Tokenizer 实例缓存 */
  private cache: Map<string, Tokenizer> = new Map();

  /** 手动注册的 tokenizer 路径 */
  private registeredPaths: Map<string, string> = new Map();

  /** 用户指定的 tokenizer 目录 */
  private userDir: string | null = null;

  /** 默认 tokenizer 实例（用于降级） */
  private defaultTokenizer: Tokenizer | null = null;

  /** 加载错误缓存 */
  private errorCache: Map<string, Error> = new Map();

  /** 正在下载的任务 */
  private downloadingTasks: Map<string, Promise<void>> = new Map();

  /** 已警告过的模型（避免重复日志） */
  private warnedModels: Set<string> = new Set();

  /** 是否禁用自动下载 */
  private disableAutoDownload: boolean = false;

  /** 降级加载任务（协调并发请求） */
  private fallbackLoadingTask: Promise<void> | null = null;

  /** 降级警告已打印 */
  private fallbackWarningPrinted: boolean = false;

  // ============================================================
  // 配置 API
  // ============================================================

  /**
   * 注册 tokenizer（手动指定路径）
   *
   * @param modelName 模型标识符（如 'qwen', 'glm', 'llama3'）
   * @param configPath tokenizer.json 文件的绝对路径
   *
   * @example
   * tokenCounter.registerTokenizer('qwen', './configs/qwen_tokenizer.json');
   * tokenCounter.registerTokenizer('llama3', './configs/llama3_tokenizer.json');
   */
  registerTokenizer(modelName: string, configPath: string): void {
    this.registeredPaths.set(modelName.toLowerCase(), configPath);
    console.log(`[TokenCounter] 注册 tokenizer: ${modelName} -> ${configPath}`);
  }

  /**
   * 设置 tokenizer 目录
   *
   * @param dir 包含 tokenizer 文件的目录
   */
  setTokenizerDir(dir: string): void {
    this.userDir = dir;
    console.log(`[TokenCounter] 设置 tokenizer 目录: ${dir}`);
  }

  /**
   * 禁用/启用自动下载
   */
  setAutoDownload(enabled: boolean): void {
    this.disableAutoDownload = !enabled;
  }

  // ============================================================
  // 加载逻辑
  // ============================================================

  /**
   * 获取 tokenizer（自动加载或下载）
   */
  async getTokenizer(modelName: string): Promise<Tokenizer> {
    const normalizedName = modelName.toLowerCase();

    // 1. 检查缓存
    const cached = this.cache.get(normalizedName);
    if (cached) return cached;

    // 2. 检查手动注册的路径
    const registeredPath = this.registeredPaths.get(normalizedName);
    if (registeredPath) {
      return this.loadFromPath(normalizedName, registeredPath);
    }

    // 3. 根据模型名称推断 HuggingFace repo
    const repoInfo = this.inferHfRepo(modelName);
    const cacheKey = this.userDir ? "user-dir" : this.buildCacheDirName(repoInfo);

    // 再次检查缓存（用 cacheKey）
    const cachedByKey = this.cache.get(cacheKey);
    if (cachedByKey) return cachedByKey;

    // 4. 检查加载错误缓存
    const cachedError = this.errorCache.get(cacheKey);
    if (cachedError) {
      // 有缓存错误，尝试降级
      return this.fallbackToDefault(modelName);
    }

    // 5. 获取 tokenizer 目录
    const tokenizerDir = this.userDir
      ? this.userDir
      : getUserTokenizerCacheDir(this.buildCacheDirName(repoInfo));

    // 6. 检查文件是否存在
    const filesExist = await this.checkFilesExist(tokenizerDir);

    if (!filesExist && !this.disableAutoDownload && !this.userDir) {
      // 7. 尝试下载
      await this.downloadIfNeeded(repoInfo, cacheKey, tokenizerDir);
    }

    // 8. 加载 tokenizer
    try {
      const tokenizer = await this.loadFromDir(tokenizerDir);
      this.cache.set(cacheKey, tokenizer);
      this.cache.set(normalizedName, tokenizer);

      if (!this.warnedModels.has(modelName)) {
        console.log(`[TokenCounter] ✅ 已加载 ${modelName} tokenizer`);
        this.warnedModels.add(modelName);
      }

      return tokenizer;
    } catch (loadError) {
      // 加载失败，降级到默认
      return this.fallbackToDefault(modelName);
    }
  }

  /**
   * 从路径加载 tokenizer
   */
  private async loadFromPath(modelName: string, filePath: string): Promise<Tokenizer> {
    const cached = this.cache.get(modelName);
    if (cached) return cached;

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const tokenizerJson = JSON.parse(content);
      const tokenizer = new Tokenizer(tokenizerJson, {});
      this.cache.set(modelName, tokenizer);
      console.log(`[TokenCounter] ✅ 从路径加载 ${modelName} tokenizer`);
      return tokenizer;
    } catch (error) {
      throw new Error(`加载 tokenizer 失败: ${filePath}\n${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 从目录加载 tokenizer
   */
  private async loadFromDir(dir: string): Promise<Tokenizer> {
    const tokenizerPath = path.join(dir, "tokenizer.json");
    const configPath = path.join(dir, "tokenizer_config.json");

    const tokenizerContent = await fs.readFile(tokenizerPath, "utf-8");
    const tokenizerJson = JSON.parse(tokenizerContent);

    let tokenizerConfig = {};
    try {
      const configContent = await fs.readFile(configPath, "utf-8");
      tokenizerConfig = JSON.parse(configContent);
    } catch {
      // config 文件可选
    }

    return new Tokenizer(tokenizerJson, tokenizerConfig);
  }

  /**
   * 检查 tokenizer 文件是否存在
   */
  private async checkFilesExist(dir: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, "tokenizer.json"));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 下载 tokenizer（如果需要）
   */
  private async downloadIfNeeded(
    repoInfo: { org: string; repo: string; variant?: string },
    cacheKey: string,
    destDir: string
  ): Promise<void> {
    // 检查是否正在下载
    const existingTask = this.downloadingTasks.get(cacheKey);
    if (existingTask) {
      try {
        await existingTask;
      } catch {
        // 下载失败，后续会降级
      }
      return;
    }

    // 开始下载
    const downloadPromise = this.downloadTokenizerFiles(repoInfo, destDir)
      .catch((error) => {
        console.error(`[TokenCounter] ❌ 下载失败: ${error instanceof Error ? error.message : error}`);
        throw error;
      });

    this.downloadingTasks.set(cacheKey, downloadPromise);

    try {
      await downloadPromise;
    } catch {
      this.downloadingTasks.delete(cacheKey);
      // 下载失败，记录错误但不抛出（后续会降级）
      this.errorCache.set(cacheKey, new Error("下载失败"));
    }
  }

  /**
   * 下载 tokenizer 文件
   */
  private async downloadTokenizerFiles(
    repoInfo: { org: string; repo: string; variant?: string },
    destDir: string
  ): Promise<void> {
    const urls = this.buildHfUrls(repoInfo);
    const repoName = repoInfo.variant
      ? `${repoInfo.repo}-${repoInfo.variant}`
      : repoInfo.repo;

    await fs.mkdir(destDir, { recursive: true });
    console.log(`[TokenCounter] 开始下载 ${repoInfo.org}/${repoName} tokenizer...`);

    // 下载 tokenizer.json
    const tokenizerDest = path.join(destDir, "tokenizer.json");
    await this.downloadFile(urls.tokenizer, tokenizerDest);
    console.log(`[TokenCounter] ✅ tokenizer.json 已下载`);

    // 下载 tokenizer_config.json（可选）
    const configDest = path.join(destDir, "tokenizer_config.json");
    try {
      await this.downloadFile(urls.config, configDest);
      console.log(`[TokenCounter] ✅ tokenizer_config.json 已下载`);
    } catch {
      console.log(`[TokenCounter] ⚠️ tokenizer_config.json 不存在，跳过`);
    }
  }

  /**
   * 下载单个文件
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`状态码 ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(buffer));
  }

  /**
   * 降级到默认 tokenizer
   */
  private async fallbackToDefault(modelName: string): Promise<Tokenizer> {
    // 如果已有默认 tokenizer，直接使用（只打印一次警告）
    if (this.defaultTokenizer) {
      if (!this.fallbackWarningPrinted) {
        this.fallbackWarningPrinted = true;
        console.log(`[TokenCounter] ⚠️ ${modelName} tokenizer 加载失败，降级使用默认 tokenizer`);
      }
      this.warnedModels.add(modelName);
      return this.defaultTokenizer;
    }

    // 检查是否有正在进行的降级加载
    if (this.fallbackLoadingTask) {
      await this.fallbackLoadingTask;
      // 加载完成后，再次检查
      if (this.defaultTokenizer) {
        this.warnedModels.add(modelName);
        return this.defaultTokenizer;
      }
      // 如果加载失败，抛出错误
      throw new Error(`Tokenizer 加载失败: 模型 ${modelName}`);
    }

    // 开始加载默认 tokenizer
    this.fallbackLoadingTask = this.loadDefaultTokenizer(modelName);

    try {
      await this.fallbackLoadingTask;
    } catch (error) {
      this.fallbackLoadingTask = null;
      throw error;
    }

    if (this.defaultTokenizer) {
      this.warnedModels.add(modelName);
      return this.defaultTokenizer;
    }

    throw new Error(`Tokenizer 加载失败: 模型 ${modelName}`);
  }

  /**
   * 加载默认 tokenizer（内部方法）
   */
  private async loadDefaultTokenizer(modelName: string): Promise<void> {
    const defaultRepo = DEFAULT_TOKENIZER_REPO;
    const defaultDir = getUserTokenizerCacheDir(this.buildCacheDirName(defaultRepo));
    const defaultKey = this.buildCacheDirName(defaultRepo);

    // 检查默认 tokenizer 是否已存在
    const defaultExists = await this.checkFilesExist(defaultDir);

    if (!defaultExists && !this.disableAutoDownload) {
      try {
        await this.downloadTokenizerFiles(defaultRepo, defaultDir);
      } catch (downloadError) {
        throw new Error(
          `Tokenizer 加载失败\n` +
          `模型: ${modelName}\n` +
          `无法下载默认 tokenizer: ${downloadError instanceof Error ? downloadError.message : downloadError}\n` +
          `解决方案:\n` +
          `  1. 检查网络连接\n` +
          `  2. 手动注册: tokenCounter.registerTokenizer('${modelName}', '/path/to/tokenizer.json')\n` +
          `  3. 或设置目录: tokenCounter.setTokenizerDir('/path/to/tokenizers/')`
        );
      }
    }

    try {
      this.defaultTokenizer = await this.loadFromDir(defaultDir);
      this.cache.set(defaultKey, this.defaultTokenizer);

      // 只打印一次降级警告
      if (!this.fallbackWarningPrinted) {
        this.fallbackWarningPrinted = true;
        console.log(`[TokenCounter] ⚠️ ${modelName} tokenizer 加载失败，降级使用 ${defaultRepo.org}/${defaultRepo.repo}`);
      }
    } catch (loadError) {
      throw new Error(`无法加载默认 tokenizer: ${loadError instanceof Error ? loadError.message : loadError}`);
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 从模型名称推断 HuggingFace repo
   */
  private inferHfRepo(modelName: string): { org: string; repo: string; variant?: string } {
    const normalized = modelName.toLowerCase();

    for (const [pattern, repoInfo] of Object.entries(MODEL_TO_HF_REPO_MAPPING)) {
      if (normalized.startsWith(pattern) || normalized.includes(pattern)) {
        return repoInfo;
      }
    }

    // 未知模型使用默认
    if (!this.warnedModels.has(modelName)) {
      this.warnedModels.add(modelName);
      console.warn(`[TokenCounter] 未知模型 "${modelName}", 使用默认 tokenizer`);
    }

    return DEFAULT_TOKENIZER_REPO;
  }

  /**
   * 构建 HuggingFace URL
   */
  private buildHfUrls(repoInfo: { org: string; repo: string; variant?: string }): { tokenizer: string; config: string } {
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
   * 构建缓存目录名
   */
  private buildCacheDirName(repoInfo: { org: string; repo: string; variant?: string }): string {
    const repoName = repoInfo.variant
      ? `${repoInfo.repo}-${repoInfo.variant}`
      : repoInfo.repo;

    return `${repoInfo.org}_${repoName.replace(/-/g, '_')}`;
  }

  // ============================================================
  // Token 计算 API
  // ============================================================

  /**
   * 计算 token 数量
   *
   * @param text 要计算的文本
   * @param modelName 模型标识符
   */
  async count(text: string, modelName: string): Promise<number> {
    if (!text) return 0;

    const tokenizer = await this.getTokenizer(modelName);
    return tokenizer.encode(text).ids.length;
  }

  /**
   * 批量计算 token 数量
   */
  async countBatch(texts: string[], modelName: string): Promise<number[]> {
    if (!texts || texts.length === 0) return [];

    const tokenizer = await this.getTokenizer(modelName);
    return texts.map(text => {
      if (!text) return 0;
      return tokenizer.encode(text).ids.length;
    });
  }

  /**
   * 同步计算（使用已加载的 tokenizer）
   */
  countSync(text: string, modelName: string): number {
    if (!text) return 0;

    const normalizedName = modelName.toLowerCase();
    const tokenizer = this.cache.get(normalizedName) || this.defaultTokenizer;

    if (!tokenizer) {
      throw new Error(`Tokenizer 未加载，请先调用 preloadTokenizer('${modelName}')`);
    }

    return tokenizer.encode(text).ids.length;
  }

  /**
   * 尝试同步计算（如果已加载）
   */
  tryCountSync(text: string, modelName: string): number | null {
    if (!text) return 0;

    const normalizedName = modelName.toLowerCase();
    const tokenizer = this.cache.get(normalizedName) || this.defaultTokenizer;

    if (!tokenizer) return null;

    return tokenizer.encode(text).ids.length;
  }

  // ============================================================
  // 状态查询 API
  // ============================================================

  /**
   * 检查 tokenizer 是否已加载
   */
  isReady(modelName: string): boolean {
    const normalizedName = modelName.toLowerCase();
    return this.cache.has(normalizedName) || this.defaultTokenizer !== null;
  }

  /**
   * 获取已加载的模型列表
   */
  getLoadedModels(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 检查是否有降级 tokenizer
   */
  hasFallback(): boolean {
    return this.defaultTokenizer !== null;
  }

  /**
   * 获取配置信息
   */
  getConfig(): {
    userDir: string | null;
    registeredPaths: Record<string, string>;
    loadedModels: string[];
    hasFallback: boolean;
    autoDownloadEnabled: boolean;
  } {
    return {
      userDir: this.userDir,
      registeredPaths: Object.fromEntries(this.registeredPaths),
      loadedModels: this.getLoadedModels(),
      hasFallback: this.hasFallback(),
      autoDownloadEnabled: !this.disableAutoDownload,
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.errorCache.clear();
    this.warnedModels.clear();
    this.downloadingTasks.clear();
    this.defaultTokenizer = null;
    this.fallbackLoadingTask = null;
    this.fallbackWarningPrinted = false;
    console.log(`[TokenCounter] 缓存已清除`);
  }
}

// ============================================================
// 单例实例
// ============================================================

const tokenCounter = new TokenCounterImpl();

// ============================================================
// 公开 API（保持原有接口兼容）
// ============================================================

/**
 * 注册 tokenizer（手动指定路径）
 */
export function registerTokenizer(modelName: string, configPath: string): void {
  tokenCounter.registerTokenizer(modelName, configPath);
}

/**
 * 设置 tokenizer 目录
 */
export function setTokenizerDir(dir: string): void {
  tokenCounter.setTokenizerDir(dir);
}

/**
 * 禁用/启用自动下载
 */
export function setAutoDownload(enabled: boolean): void {
  tokenCounter.setAutoDownload(enabled);
}

/**
 * 预加载 tokenizer
 */
export async function preloadTokenizer(modelName?: string): Promise<void> {
  const model = modelName || "qwen-plus";

  try {
    await tokenCounter.getTokenizer(model);
    console.log(`[TokenCounter] 预加载完成 (${model})`);
  } catch (error) {
    console.error("[TokenCounter] 预加载失败:", error instanceof Error ? error.message : error);
  }
}

/**
 * 检查 tokenizer 是否已加载
 */
export function isTokenizerReady(modelName?: string): boolean {
  return tokenCounter.isReady(modelName || "qwen-plus");
}

/**
 * 检查 tokenizer 文件是否存在
 */
export async function hasTokenizerFile(modelName?: string): Promise<boolean> {
  // 简化实现，检查是否已加载
  return tokenCounter.isReady(modelName || "qwen-plus");
}

/**
 * 确保 tokenizer 可用
 */
export async function ensureTokenizerAvailable(modelName: string): Promise<boolean> {
  try {
    await tokenCounter.getTokenizer(modelName);
    return true;
  } catch {
    return false;
  }
}

/**
 * 强制重新下载 tokenizer
 */
export async function refreshTokenizer(modelName: string): Promise<void> {
  // 清除缓存后重新加载
  tokenCounter.clearCache();
  await preloadTokenizer(modelName);
}

/**
 * 获取缓存状态
 */
export async function getTokenizerCacheStatus(modelName: string): Promise<{
  cached: boolean;
  cachePath: string | null;
  size: number | null;
}> {
  const isCached = tokenCounter.isReady(modelName);
  return {
    cached: isCached,
    cachePath: isCached ? getUserTokenizerCacheDir() : null,
    size: null,
  };
}

/**
 * 获取配置信息
 */
export function getTokenizerConfig() {
  return tokenCounter.getConfig();
}

/**
 * 计算 token 数量
 */
export async function countTokens(text: string, modelName?: string): Promise<number> {
  return tokenCounter.count(text, modelName || "qwen-plus");
}

/**
 * 批量计算 token 数量
 */
export async function countTokensBatch(texts: string[], modelName?: string): Promise<number[]> {
  return tokenCounter.countBatch(texts, modelName || "qwen-plus");
}

/**
 * 同步计算 token 数量
 */
export function countTokensSync(text: string, modelName?: string): number {
  return tokenCounter.countSync(text, modelName || "qwen-plus");
}

/**
 * 尝试同步计算
 */
export function tryCountTokensSync(text: string, modelName?: string): number | null {
  return tokenCounter.tryCountSync(text, modelName || "qwen-plus");
}

/**
 * 导出 inferHfRepo（用于 token-counter.ts）
 */
export function inferHfRepo(modelName: string): { org: string; repo: string; variant?: string } {
  const normalized = modelName.toLowerCase();

  for (const [pattern, repoInfo] of Object.entries(MODEL_TO_HF_REPO_MAPPING)) {
    if (normalized.startsWith(pattern) || normalized.includes(pattern)) {
      return repoInfo;
    }
  }

  return DEFAULT_TOKENIZER_REPO;
}

export function buildHfUrls(repoInfo: { org: string; repo: string; variant?: string }): { tokenizer: string; config: string } {
  const repoName = repoInfo.variant
    ? `${repoInfo.repo}-${repoInfo.variant}`
    : repoInfo.repo;

  const baseUrl = `${HF_MIRROR_BASE_URL}/${repoInfo.org}/${repoName}/resolve/main`;

  return {
    tokenizer: `${baseUrl}/tokenizer.json`,
    config: `${baseUrl}/tokenizer_config.json`,
  };
}

// ============================================================
// 直接导出 TokenCounter 实例（高级用法）
// ============================================================

export { tokenCounter };