/**
 * TF-IDF 搜索函数
 *
 * 使用 TF-IDF + 余弦相似度搜索相关技能。
 * 支持名称匹配加成。
 */

import { tokenizeAndStem } from './tokenizer';
import { getSkillIndexCache, computeIdf } from './tfidf-index';
import type { SkillIndexEntry } from './tfidf-index';

/**
 * 搜索结果
 */
export interface SearchResult {
  name: string;
  description: string;
  score: number;
  sourcePath?: string;
  contentLength?: number;
}

/**
 * 搜索配置
 */
export interface SearchOptions {
  limit?: number;           // 结果数量限制
  minScore?: number;        // 最小分数阈值
  nameMatchBonus?: number;  // 名称匹配加成分数
}

/**
 * 默认搜索配置
 */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  limit: 5,
  minScore: 0.10,
  nameMatchBonus: 0.4,
};

/**
 * 余弦相似度计算
 *
 * @param queryTfIdf - 查询的 TF-IDF 向量
 * @param docTfIdf - 文档的 TF-IDF 向量
 * @returns 相似度分数 (0-1)
 */
function cosineSimilarity(
  queryTfIdf: Map<string, number>,
  docTfIdf: Map<string, number>
): number {
  let dot = 0;
  let normQ = 0;
  let normD = 0;

  // 计算点积和查询向量范数
  for (const [term, qWeight] of queryTfIdf) {
    const dWeight = docTfIdf.get(term) ?? 0;
    dot += qWeight * dWeight;
    normQ += qWeight * qWeight;
  }

  // 计算文档向量范数
  for (const dWeight of docTfIdf.values()) {
    normD += dWeight * dWeight;
  }

  // 计算余弦相似度
  const denom = Math.sqrt(normQ) * Math.sqrt(normD);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 搜索技能
 *
 * @param query - 搜索查询文本
 * @param index - 技能索引
 * @param options - 搜索配置
 * @returns 搜索结果数组
 */
export function searchSkills(
  query: string,
  index: SkillIndexEntry[],
  options?: SearchOptions
): SearchResult[] {
  // 合并默认配置
  const {
    limit = 5,
    minScore = 0.10,
    nameMatchBonus = 0.4,
  } = { ...DEFAULT_SEARCH_OPTIONS, ...options };

  // 空查询或空索引
  if (index.length === 0 || !query.trim()) return [];

  // 分词
  const queryTokens = tokenizeAndStem(query);
  if (queryTokens.length === 0) return [];

  // 计算查询 TF
  const queryTf = new Map<string, number>();
  const freq = new Map<string, number>();
  for (const t of queryTokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  // Max-normalize
  let max = 1;
  for (const v of freq.values()) {
    if (v > max) max = v;
  }

  for (const [term, count] of freq) {
    queryTf.set(term, count / max);
  }

  // 获取 IDF (使用缓存或重新计算)
  const { idf: cachedIdf } = getSkillIndexCache();
  const idf = cachedIdf ?? computeIdf(index);

  // 计算查询 TF-IDF
  const queryTfIdf = new Map<string, number>();
  for (const [term, tf] of queryTf) {
    queryTfIdf.set(term, tf * (idf.get(term) ?? 0));
  }

  // 规范化查询文本用于名称匹配
  const queryLower = query.toLowerCase().replace(/[-_]/g, ' ');

  // 搜索
  const results: SearchResult[] = [];

  for (const entry of index) {
    // 计算相似度
    let score = cosineSimilarity(queryTfIdf, entry.tfVector);

    // 名称匹配加成
    // 只对长度 >= 4 的名称进行加成，避免短名称误匹配
    if (entry.name.length >= 4) {
      if (queryLower.includes(entry.normalizedName)) {
        score = Math.max(score, nameMatchBonus);
      }
    }

    // 过滤低分结果
    if (score >= minScore) {
      results.push({
        name: entry.name,
        description: entry.description,
        score,
        sourcePath: entry.sourcePath,
        contentLength: entry.contentLength,
      });
    }
  }

  // 按分数降序排序，限制数量
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * 批量搜索
 *
 * 对多个查询词进行搜索，合并结果。
 *
 * @param queries - 查询文本数组
 * @param index - 技能索引
 * @param options - 搜索配置
 * @returns 合并后的搜索结果
 */
export function batchSearchSkills(
  queries: string[],
  index: SkillIndexEntry[],
  options?: SearchOptions
): SearchResult[] {
  // 对每个查询搜索
  const allResults = new Map<string, SearchResult>();

  for (const query of queries) {
    const results = searchSkills(query, index, options);
    for (const result of results) {
      const existing = allResults.get(result.name);
      if (!existing || result.score > existing.score) {
        allResults.set(result.name, result);
      }
    }
  }

  // 返回合并结果，按分数排序
  return Array.from(allResults.values())
    .sort((a, b) => b.score - a.score);
}