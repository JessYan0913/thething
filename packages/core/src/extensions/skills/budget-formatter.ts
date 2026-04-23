/**
 * Skill 预算格式化器
 *
 * 控制 skill listing 在 context window 中的占用：
 * - 默认占用 1% context window
 * - 单条描述硬上限 250 字符
 * - 支持特定技能保持完整描述
 */

import type { Skill } from './types';

/**
 * Skill listing 预算配置
 */
export const SKILL_BUDGET_CONFIG = {
  // Context window 占用比例
  CONTEXT_PERCENT: 0.01,         // 1%

  // 每字符约 4 个 token
  CHARS_PER_TOKEN: 4,

  // 默认字符预算 (fallback)
  DEFAULT_CHAR_BUDGET: 8000,     // 1% of 200k × 4

  // 单条描述硬上限
  MAX_DESC_CHARS: 250,

  // 最小描述长度 (极端情况下)
  MIN_DESC_LENGTH: 20,
} as const;

/**
 * 计算字符预算
 *
 * @param contextWindowTokens - context window token 数量
 * @returns 可用于技能列表的字符数
 */
export function getCharBudget(contextWindowTokens?: number): number {
  if (contextWindowTokens && contextWindowTokens > 0) {
    return Math.floor(
      contextWindowTokens * SKILL_BUDGET_CONFIG.CHARS_PER_TOKEN
      * SKILL_BUDGET_CONFIG.CONTEXT_PERCENT
    );
  }
  return SKILL_BUDGET_CONFIG.DEFAULT_CHAR_BUDGET;
}

/**
 * 截断描述
 *
 * @param desc - 描述文本
 * @param maxChars - 最大字符数
 * @returns 截断后的描述
 */
export function truncateDescription(desc: string, maxChars: number): string {
  if (desc.length <= maxChars) return desc;
  return desc.slice(0, maxChars - 1) + '…';
}

/**
 * 需要保持完整描述的来源
 */
const FULL_DESC_SOURCES: Set<string> = new Set(['bundled', 'project']);

/**
 * 格式化技能列表，在预算内
 *
 * @param skills - 技能列表
 * @param contextWindowTokens - context window token 数量
 * @param options - 可选配置
 * @returns 格式化后的技能列表字符串
 */
export function formatSkillsWithinBudget(
  skills: Skill[],
  contextWindowTokens?: number,
  options?: {
    alwaysFull?: string[];  // 哪些技能名称保持完整描述
  }
): string {
  if (skills.length === 0) return '';

  const budget = getCharBudget(contextWindowTokens);
  const alwaysFull = new Set(options?.alwaysFull ?? []);
  const fullDescSources = new Set(FULL_DESC_SOURCES);

  // 计算每条完整描述的总长度
  const entries = skills.map(s => ({
    skill: s,
    full: formatSkillEntry(s),
    isAlwaysFull: alwaysFull.has(s.name) || fullDescSources.has(s.source ?? ''),
  }));

  const fullTotal = entries.reduce(
    (sum, e) => sum + e.full.length + 1,
    0
  ) - 1;

  // 如果总长度在预算内，直接返回
  if (fullTotal <= budget) {
    return entries.map(e => e.full).join('\n');
  }

  // 超预算：计算非 alwaysFull 技能的可用描述长度
  const alwaysFullChars = entries.reduce(
    (sum, e) => e.isAlwaysFull ? sum + e.full.length + 1 : sum,
    0
  );
  const remainingBudget = budget - alwaysFullChars;

  const restEntries = entries.filter(e => !e.isAlwaysFull);
  if (restEntries.length === 0) {
    return entries.filter(e => e.isAlwaysFull).map(e => e.full).join('\n');
  }

  // 计算非 alwaysFull 技能的最大描述长度
  // nameOverhead: 名称 + ": " + 路径信息
  const nameOverhead = restEntries.reduce(
    (sum, e) => {
      const pathLen = e.skill.sourcePath ? `(source: ${e.skill.sourcePath})`.length : 0;
      return sum + e.skill.name.length + 4 + pathLen; // "- name: " + path
    },
    0
  ) + restEntries.length - 1; // newlines

  const availableForDescs = remainingBudget - nameOverhead;
  const maxDescLen = Math.floor(availableForDescs / restEntries.length);

  if (maxDescLen < SKILL_BUDGET_CONFIG.MIN_DESC_LENGTH) {
    // 极端情况：只显示名称和路径
    return entries.map(e => {
      if (e.isAlwaysFull) return e.full;
      const sourcePath = e.skill.sourcePath ? ` (source: ${e.skill.sourcePath})` : '';
      return `- ${e.skill.name}${sourcePath}`;
    }).join('\n');
  }

  // 截断描述，保留路径
  return entries.map(e => {
    if (e.isAlwaysFull) return e.full;
    const desc = getSkillDescription(e.skill);
    const sourcePath = e.skill.sourcePath ? ` (source: ${e.skill.sourcePath})` : '';
    return `- ${e.skill.name}: ${truncateDescription(desc, maxDescLen)}${sourcePath}`;
  }).join('\n');
}

/**
 * 格式化单条技能
 *
 * @param skill - 技能对象
 * @returns 格式化后的技能条目（包含源文件路径）
 */
function formatSkillEntry(skill: Skill): string {
  const desc = getSkillDescription(skill);
  const truncated = truncateDescription(desc, SKILL_BUDGET_CONFIG.MAX_DESC_CHARS);
  // 添加源文件路径，方便 Agent 直接读取完整内容
  const sourcePath = skill.sourcePath ? ` (source: ${skill.sourcePath})` : '';
  return `- ${skill.name}: ${truncated}${sourcePath}`;
}

/**
 * 获取技能描述 (description + whenToUse)
 *
 * @param skill - 技能对象
 * @returns 合并后的描述
 */
function getSkillDescription(skill: Skill): string {
  if (skill.whenToUse) {
    return `${skill.description} - ${skill.whenToUse}`;
  }
  return skill.description;
}

/**
 * 计算格式化后的预估字符数
 *
 * @param skills - 技能列表
 * @param contextWindowTokens - context window token 数量
 * @returns 预估字符数
 */
export function estimateFormattedChars(
  skills: Skill[],
  contextWindowTokens?: number
): number {
  return formatSkillsWithinBudget(skills, contextWindowTokens).length;
}

/**
 * 计算预估 token 数
 *
 * @param chars - 字符数
 * @returns 预估 token 数
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / SKILL_BUDGET_CONFIG.CHARS_PER_TOKEN);
}