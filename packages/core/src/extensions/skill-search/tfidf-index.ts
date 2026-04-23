/**
 * TF-IDF 索引构建
 *
 * 构建技能的 TF-IDF 索引，支持加权字段：
 * - name: 权重 3.0
 * - whenToUse: 权重 2.0
 * - description: 权重 1.0
 */

import { tokenizeAndStem } from './tokenizer';
import type { Skill } from '../skills/types';
import type { SkillIndexEntry } from '../attachments/types';

export type { SkillIndexEntry };

/**
 * 字段权重配置
 */
export const FIELD_WEIGHT = {
  name: 3.0,
  whenToUse: 2.0,
  description: 1.0,
} as const;

/**
 * 计算加权 TF 向量
 *
 * 使用 max-normalized TF，乘以字段权重。
 *
 * @param fields - 字段数组，包含 tokens 和权重
 * @returns 加权 TF 向量
 */
function computeWeightedTf(
  fields: { tokens: string[]; weight: number }[]
): Map<string, number> {
  const weighted = new Map<string, number>();

  for (const field of fields) {
    // 计算词频
    const freq = new Map<string, number>();
    for (const t of field.tokens) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }

    // 找到最大频率
    let max = 1;
    for (const v of freq.values()) {
      if (v > max) max = v;
    }

    // 计算 normalized TF * weight
    for (const [term, count] of freq) {
      const val = (count / max) * field.weight;
      const existing = weighted.get(term) ?? 0;
      // 使用 max 而非 sum，避免重复加权
      if (val > existing) {
        weighted.set(term, val);
      }
    }
  }

  return weighted;
}

/**
 * 计算 IDF (逆文档频率)
 *
 * IDF = log(N / df)
 * - N: 文档总数
 * - df: 包含该词的文档数
 *
 * @param index - 索引条目数组
 * @returns IDF 向量
 */
export function computeIdf(index: SkillIndexEntry[]): Map<string, number> {
  const df = new Map<string, number>();

  // 计算文档频率
  for (const entry of index) {
    const seen = new Set<string>();
    for (const t of entry.tokens) {
      if (!seen.has(t)) {
        df.set(t, (df.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
  }

  // 计算 IDF
  const N = index.length;
  const idf = new Map<string, number>();

  for (const [term, count] of df) {
    // 使用 log(N/df)，避免出现负数
    idf.set(term, Math.log(N / count));
  }

  return idf;
}

/**
 * 规范化技能名称
 *
 * 转小写，替换连接符为空格。
 *
 * @param name - 技能名称
 * @returns 规范化后的名称
 */
function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, ' ');
}

/**
 * 构建技能索引
 *
 * @param skills - 技能数组
 * @returns 索引条目数组
 */
export async function buildSkillIndex(
  skills: Skill[]
): Promise<SkillIndexEntry[]> {
  const entries: SkillIndexEntry[] = [];

  for (const skill of skills) {
    // 分词
    const nameTokens = tokenizeAndStem(skill.name);
    const descTokens = tokenizeAndStem(skill.description);
    const whenTokens = tokenizeAndStem(skill.whenToUse ?? '');

    // 合并所有唯一 token
    const allTokens = [...new Set([
      ...nameTokens,
      ...descTokens,
      ...whenTokens,
    ])];

    // 计算加权 TF 向量
    const tfVector = computeWeightedTf([
      { tokens: nameTokens, weight: FIELD_WEIGHT.name },
      { tokens: whenTokens, weight: FIELD_WEIGHT.whenToUse },
      { tokens: descTokens, weight: FIELD_WEIGHT.description },
    ]);

    entries.push({
      name: skill.name,
      normalizedName: normalizeSkillName(skill.name),
      description: skill.description,
      whenToUse: skill.whenToUse,
      source: skill.source ?? 'project',
      sourcePath: skill.sourcePath,
      contentLength: skill.body?.length,
      tokens: allTokens,
      tfVector,
    });
  }

  return entries;
}

// ============================================================================
// 索引缓存
// ============================================================================

/**
 * 索引缓存
 *
 * Session 级缓存，避免重复构建。
 */
let cachedIndex: SkillIndexEntry[] | null = null;
let cachedIdf: Map<string, number> | null = null;

/**
 * 获取索引缓存
 *
 * @returns 缓存的索引和 IDF
 */
export function getSkillIndexCache(): {
  index: SkillIndexEntry[] | null;
  idf: Map<string, number> | null;
} {
  return { index: cachedIndex, idf: cachedIdf };
}

/**
 * 设置索引缓存
 *
 * @param index - 索引条目数组
 * @param idf - IDF 向量
 */
export function setSkillIndexCache(
  index: SkillIndexEntry[],
  idf: Map<string, number>
): void {
  cachedIndex = index;
  cachedIdf = idf;
}

/**
 * 清除索引缓存
 */
export function clearSkillIndexCache(): void {
  cachedIndex = null;
  cachedIdf = null;
}

/**
 * 检查是否有缓存
 */
export function hasIndexCache(): boolean {
  return cachedIndex !== null && cachedIdf !== null;
}

/**
 * 获取缓存大小
 */
export function getIndexCacheSize(): number {
  return cachedIndex?.length ?? 0;
}