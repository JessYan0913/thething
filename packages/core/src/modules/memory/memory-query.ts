// ============================================================
// Memory Query - 三因子检索（recency × importance × relevance）
// ============================================================
// Generative Agents (Park et al. 2023) 检索范式：
// score = w_r·recency + w_i·importance + w_v·relevance
// 记忆量小时全量注入（按分排序），量变后 top-k 截断防止塞爆上下文。

import type { MemoryEntry, MemoryType } from './memory-io'

// ============================================================
// 因子计算
// ============================================================

/** importance 缺省值：按记忆类型派生（1-10） */
const DEFAULT_IMPORTANCE: Record<MemoryType, number> = {
  correction: 8,
  explicit: 7,
  identity: 6,
  preference: 5,
}

export function getImportance(entry: MemoryEntry): number {
  if (entry.importance !== undefined && entry.importance >= 1 && entry.importance <= 10) {
    return entry.importance
  }
  return DEFAULT_IMPORTANCE[entry.type] ?? 5
}

/** 归一化 importance 到 [0,1] */
export function importanceScore(entry: MemoryEntry): number {
  return (getImportance(entry) - 1) / 9
}

/** recency：基于 updated 时间衰减，30 天半衰期，越新越高 */
export function recencyScore(entry: MemoryEntry, now: number = Date.now()): number {
  const ageMs = now - new Date(entry.updated).getTime()
  const ageDays = ageMs / 86_400_000
  if (ageDays <= 0) return 1
  return Math.exp(-ageDays / 30)
}

// ============================================================
// relevance：轻量关键词匹配（不上向量库）
// ============================================================

/**
 * 提取匹配 token：英文单词（≥2 字符）+ 中文 2-gram。
 * 中文逐字匹配噪声大，2-gram 是轻量且够用的折中。
 */
function tokenizeForMatch(text: string): string[] {
  const tokens: string[] = []
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
  for (const word of normalized.match(/[a-z0-9]+/g) ?? []) {
    if (word.length >= 2) tokens.push(word)
  }
  const cjk = normalized.replace(/[^一-鿿]/g, '')
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.push(cjk.slice(i, i + 2))
  }
  return tokens
}

/** relevance：query 中出现在 content 里的 token 比例（0-1），无 query 时为 0 */
export function relevanceScore(query: string | undefined, content: string): number {
  if (!query) return 0
  const queryTokens = tokenizeForMatch(query)
  if (queryTokens.length === 0) return 0
  const contentTokens = new Set(tokenizeForMatch(content))
  const hit = queryTokens.filter(t => contentTokens.has(t)).length
  return hit / queryTokens.length
}

// ============================================================
// 综合排序
// ============================================================

export interface MemoryRankOptions {
  /** 当前用户消息（用于 relevance 打分） */
  query?: string
  /** 注入上限；省略或 0 时不过滤（全量按分排序） */
  topK?: number
  /** 三因子权重。默认 relevance 权重更高：相关性决定"该不该出现"，新鲜度只区分同维度新旧 */
  weights?: { recency: number; importance: number; relevance: number }
}

const DEFAULT_WEIGHTS = { recency: 1, importance: 1, relevance: 2 }

/**
 * 按 recency/importance/relevance 三因子打分排序。
 * pinned 优先置顶；分数相同按创建时间倒序。
 */
export function rankMemories(
  entries: MemoryEntry[],
  options?: MemoryRankOptions,
): MemoryEntry[] {
  const weights = options?.weights ?? DEFAULT_WEIGHTS
  const now = Date.now()

  const scored = entries.map(entry => {
    const score =
      weights.recency * recencyScore(entry, now)
      + weights.importance * importanceScore(entry)
      + weights.relevance * relevanceScore(options?.query, entry.content)
    return { entry, score }
  })

  scored.sort((a, b) => {
    if (a.entry.pinned !== b.entry.pinned) return a.entry.pinned ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    return b.entry.created.localeCompare(a.entry.created)
  })

  const ranked = scored.map(s => s.entry)
  return options?.topK && options.topK > 0 ? ranked.slice(0, options.topK) : ranked
}
