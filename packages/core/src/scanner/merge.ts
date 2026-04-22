// ============================================================
// Scanner - 配置合并与缓存
// ============================================================

// ============================================================
// 按优先级合并
// ============================================================

/**
 * 按优先级合并配置项
 *
 * @param items 配置项列表（带 source 字段）
 * @param priorityOrder 优先级顺序（如 ['project', 'user']，project 最高）
 * @param getKey 获取唯一标识的函数
 * @returns 合并后的列表
 */
export function mergeByPriority<T extends { source: string }>(
  items: T[],
  priorityOrder: string[],
  getKey: (item: T) => string,
): T[] {
  const merged = new Map<string, T>();

  // 按优先级顺序处理（低优先级先处理，高优先级覆盖）
  const reversedOrder = [...priorityOrder].reverse();

  for (const source of reversedOrder) {
    for (const item of items) {
      const key = getKey(item);
      if (item.source === source) {
        merged.set(key, item);
      }
    }
  }

  return Array.from(merged.values());
}

// ============================================================
// 缓存
// ============================================================

export interface CacheConfig {
  /** 缓存 TTL（毫秒），默认 60 秒 */
  ttlMs?: number;
  /** 最大缓存条目数 */
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 100;

interface CacheEntry<T> {
  data: T;
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

  set(key: string, data: T): void {
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

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