/**
 * 加载缓存 - 用于缓存 Agent/Skills 加载结果
 */

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** 缓存 TTL（毫秒），默认 60 秒 */
  ttlMs?: number;
  /** 最大缓存条目数 */
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 60_000; // 60 秒
const DEFAULT_MAX_ENTRIES = 100;

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  /** 缓存数据 */
  data: T;
  /** 缓存时间戳 */
  timestamp: number;
}

/**
 * 通用加载缓存
 */
export class LoadingCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(config?: CacheConfig) {
    this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * 获取缓存（如果未过期）
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * 设置缓存
   */
  set(key: string, data: T): void {
    // 清理过期条目或超出限制时清理最旧的
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * 检查缓存是否存在且未过期
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    maxEntries: number;
    ttlMs: number;
  } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    };
  }

  /**
   * 清理过期条目
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 清理最旧的条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

/**
 * 创建带缓存的加载函数
 */
export function createCachedLoader<T>(
  loader: (key: string) => Promise<T>,
  config?: CacheConfig,
): (key: string) => Promise<T> {
  const cache = new LoadingCache<T>(config);

  return async (key: string): Promise<T> => {
    const cached = cache.get(key);
    if (cached !== null) {
      return cached;
    }

    const data = await loader(key);
    cache.set(key, data);
    return data;
  };
}