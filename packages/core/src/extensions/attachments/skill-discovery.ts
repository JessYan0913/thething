/**
 * Skill Discovery 附件
 *
 * 用于 TF-IDF 搜索发现相关技能后注入。
 * - Turn Zero: 根据用户输入搜索
 * - Inter-turn: 预加载搜索
 * - 自动加载高置信度技能的完整内容
 */

import type { Skill } from '../skills/types';
import { searchSkills, SearchResult } from '../skill-search/search';
import {
  buildSkillIndex,
  computeIdf,
  setSkillIndexCache,
  getSkillIndexCache,
} from '../skill-search/tfidf-index';
import type {
  SkillDiscoveryAttachment,
  SkillDiscoveryResult,
  DiscoverySignal,
} from './types';

/**
 * Skill discovery 配置
 */
export const SKILL_DISCOVERY_CONFIG = {
  // 自动加载最低分数
  AUTO_LOAD_MIN_SCORE: 0.30,

  // 自动加载数量上限
  AUTO_LOAD_LIMIT: 2,

  // 自动加载内容最大字符数
  AUTO_LOAD_MAX_CHARS: 12000,

  // 搜索结果数量上限
  SEARCH_LIMIT: 5,

  // 最小搜索分数
  MIN_SCORE: 0.10,
} as const;

/**
 * 会话内已发现的技能
 */
const discoveredThisSession = new Map<string, Set<string>>();

/**
 * 获取会话的已发现技能集合
 */
function getDiscoveredSet(sessionKey: string): Set<string> {
  let set = discoveredThisSession.get(sessionKey);
  if (!set) {
    set = new Set();
    discoveredThisSession.set(sessionKey, set);
  }
  return set;
}

/**
 * 标记技能为已发现
 */
function markDiscovered(sessionKey: string, skillName: string): void {
  getDiscoveredSet(sessionKey).add(skillName);
}

/**
 * 检查是否已发现
 */
function isAlreadyDiscovered(sessionKey: string, skillName: string): boolean {
  return getDiscoveredSet(sessionKey).has(skillName);
}

/**
 * 获取 Turn Zero skill_discovery 附件
 *
 * 根据用户输入搜索相关技能，自动加载高置信度技能。
 *
 * @param userInput - 用户输入
 * @param skills - 技能列表
 * @param sessionKey - session 唯一标识
 * @param options - 可选配置
 * @returns skill_discovery 附件或 null
 */
export async function getTurnZeroSkillDiscovery(
  userInput: string,
  skills: Skill[],
  sessionKey: string,
  options?: {
    autoLoadBody?: (skillName: string) => Promise<string | null>;
  }
): Promise<SkillDiscoveryAttachment | null> {
  if (!userInput.trim()) return null;

  const startedAt = Date.now();

  // 构建索引
  const index = await buildSkillIndex(skills);
  const idf = computeIdf(index);
  setSkillIndexCache(index, idf);

  // 搜索
  const results = searchSkills(userInput, index, {
    limit: SKILL_DISCOVERY_CONFIG.SEARCH_LIMIT,
    minScore: SKILL_DISCOVERY_CONFIG.MIN_SCORE,
  });

  // 过滤已发现的
  const newResults = results.filter(r => !isAlreadyDiscovered(sessionKey, r.name));
  if (newResults.length === 0) return null;

  // 富化：自动加载高置信度技能
  const enriched = await enrichResultsForAutoLoad(
    newResults,
    skills,
    options?.autoLoadBody
  );

  // 标记为已发现
  for (const r of enriched) {
    markDiscovered(sessionKey, r.name);
  }

  const signal: DiscoverySignal = {
    trigger: 'user_input',
    queryText: userInput.slice(0, 200),
    startedAt,
    durationMs: Date.now() - startedAt,
    indexSize: index.length,
    method: 'tfidf',
  };

  return {
    type: 'skill_discovery',
    skills: enriched,
    signal,
    source: 'native',
  };
}

/**
 * 预加载搜索 (Inter-turn)
 *
 * 使用缓存的索引进行搜索，不自动加载内容。
 *
 * @param input - 搜索输入
 * @param skills - 技能列表 (用于获取完整数据)
 * @param sessionKey - session 唯一标识
 * @returns skill_discovery 附件或 null
 */
export async function startSkillDiscoveryPrefetch(
  input: string | null,
  skills: Skill[],
  sessionKey: string
): Promise<SkillDiscoveryAttachment | null> {
  if (!input?.trim()) return null;

  const startedAt = Date.now();

  // 使用缓存索引
  const { index } = getSkillIndexCache();
  if (!index) return null;

  // 搜索
  const results = searchSkills(input, index, {
    limit: SKILL_DISCOVERY_CONFIG.SEARCH_LIMIT,
    minScore: SKILL_DISCOVERY_CONFIG.MIN_SCORE,
  });

  // 过滤已发现的
  const newResults = results.filter(r => !isAlreadyDiscovered(sessionKey, r.name));
  if (newResults.length === 0) return null;

  // 标记为已发现
  for (const r of newResults) {
    markDiscovered(sessionKey, r.name);
  }

  const signal: DiscoverySignal = {
    trigger: 'assistant_turn',
    queryText: input.slice(0, 200),
    startedAt,
    durationMs: Date.now() - startedAt,
    indexSize: index.length,
    method: 'tfidf',
  };

  return {
    type: 'skill_discovery',
    skills: newResults.map(r => ({
      name: r.name,
      description: r.description,
      score: r.score,
      autoLoaded: false,
    })),
    signal,
    source: 'native',
  };
}

/**
 * 富化搜索结果：自动加载高置信度技能
 *
 * @param results - 搜索结果
 * @param skills - 技能列表
 * @param autoLoadBody - 自动加载函数
 * @returns 富化后的结果
 */
async function enrichResultsForAutoLoad(
  results: SearchResult[],
  skills: Skill[],
  autoLoadBody?: (skillName: string) => Promise<string | null>
): Promise<SkillDiscoveryResult[]> {
  let loadedCount = 0;
  const enriched: SkillDiscoveryResult[] = [];

  for (const result of results) {
    const base: SkillDiscoveryResult = {
      name: result.name,
      description: result.description,
      score: result.score,
      autoLoaded: false,
    };

    // 检查是否应该自动加载
    if (
      loadedCount < SKILL_DISCOVERY_CONFIG.AUTO_LOAD_LIMIT &&
      result.score >= SKILL_DISCOVERY_CONFIG.AUTO_LOAD_MIN_SCORE &&
      autoLoadBody
    ) {
      const body = await autoLoadBody(result.name);
      if (body && body.length <= SKILL_DISCOVERY_CONFIG.AUTO_LOAD_MAX_CHARS) {
        loadedCount++;
        enriched.push({
          ...base,
          autoLoaded: true,
          content: body,
          path: result.sourcePath,
        });
        continue;
      }
    }

    enriched.push(base);
  }

  return enriched;
}

/**
 * 格式化 skill_discovery 附件为消息内容
 *
 * @param attachment - skill_discovery 附件
 * @returns 格式化后的消息内容
 */
export function formatSkillDiscoveryMessage(
  attachment: SkillDiscoveryAttachment
): string {
  const lines: string[] = [];

  for (const skill of attachment.skills) {
    if (skill.autoLoaded && skill.content) {
      // 自动加载的完整内容
      lines.push(`Skill "${skill.name}" (score: ${skill.score.toFixed(2)}):`);
      lines.push(skill.content);
      lines.push('');
    } else {
      // 摘要
      lines.push(`- ${skill.name}: ${skill.description} (score: ${skill.score.toFixed(2)})`);
    }
  }

  return lines.join('\n');
}

/**
 * 清除会话发现状态
 *
 * @param sessionKey - session 唯一标识
 */
export function clearDiscoveryState(sessionKey: string): void {
  discoveredThisSession.delete(sessionKey);
}

/**
 * 清除所有发现状态
 */
export function clearAllDiscoveryState(): void {
  discoveredThisSession.clear();
}

/**
 * 获取会话已发现技能数量
 *
 * @param sessionKey - session 唯一标识
 * @returns 已发现技能数量
 */
export function getDiscoveredCount(sessionKey: string): number {
  return getDiscoveredSet(sessionKey).size;
}