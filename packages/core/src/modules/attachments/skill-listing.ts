/**
 * Skill Listing 附件
 *
 * 用于注入技能摘要列表到消息附件。
 * - 预算控制在 context window 的 1%
 * - 只显示 bundled 和 mcp 来源的技能
 * - 追踪已发送技能，避免重复注入
 */

import type { Skill } from '../skills/types';
import { formatSkillsWithinBudget } from '../skills/budget-formatter';
import { getNewSkills, markSkillsSent, getSentSkills } from './sent-tracker';
import type { SkillListingAttachment } from './types';

/**
 * Skill listing 配置
 */
export const SKILL_LISTING_CONFIG = {
  // 最大技能数量
  MAX_SKILLS: 30,

  // 哪些来源总是显示（project 技能也应该显示）
  ALWAYS_VISIBLE: ['bundled', 'mcp', 'project'] as string[],

  // 哪些技能来源需要完整描述
  ALWAYS_FULL: ['bundled', 'project'] as string[],
} as const;

/**
 * 过滤可见技能
 *
 * @param skills - 技能列表
 * @param filterSources - 可选的来源过滤
 * @returns 可见技能列表
 */
export function filterVisibleSkills(
  skills: Skill[],
  filterSources?: string[]
): Skill[] {
  if (filterSources) {
    return skills.filter(s =>
      filterSources.includes(s.source ?? 'project')
    );
  }

  // 默认：只显示 bundled 和 mcp
  return skills.filter(s =>
    SKILL_LISTING_CONFIG.ALWAYS_VISIBLE.includes(s.source ?? 'project')
  );
}

/**
 * 获取 skill_listing 附件
 *
 * @param skills - 技能列表
 * @param sessionKey - session 唯一标识
 * @param contextWindowTokens - context window token 数量
 * @param options - 可选配置
 * @returns skill_listing 附件或 null
 */
export async function getSkillListingAttachment(
  skills: Skill[],
  sessionKey: string,
  contextWindowTokens?: number,
  options?: {
    suppressNext?: boolean;  // resume 场景：跳过首次发送
    filterSources?: string[];
  }
): Promise<SkillListingAttachment | null> {
  // 过滤可见技能
  let visibleSkills = filterVisibleSkills(skills, options?.filterSources);

  // 限制数量
  if (visibleSkills.length > SKILL_LISTING_CONFIG.MAX_SKILLS) {
    visibleSkills = visibleSkills.slice(0, SKILL_LISTING_CONFIG.MAX_SKILLS);
  }

  // 检查是否是 resume 场景
  if (options?.suppressNext) {
    // 标记所有当前技能为已发送，返回空
    markSkillsSent(sessionKey, visibleSkills.map(s => s.name));
    return null;
  }

  // 找出新技能
  const newSkills = getNewSkills(sessionKey, visibleSkills);
  if (newSkills.length === 0) return null;

  // 是否是首次发送
  const sentSkills = getSentSkills(sessionKey);
  const isInitial = sentSkills.size === 0;

  // 标记为已发送
  markSkillsSent(sessionKey, newSkills.map(s => s.name));

  // 格式化
  const content = formatSkillsWithinBudget(newSkills, contextWindowTokens, {
    alwaysFull: [...SKILL_LISTING_CONFIG.ALWAYS_FULL],
  });

  return {
    type: 'skill_listing',
    content,
    skillCount: newSkills.length,
    isInitial,
  };
}

/**
 * 格式化 skill_listing 附件为消息内容
 *
 * 参考 Claude Code 的格式：
 * "The following skills are available for use with the Skill tool:"
 *
 * @param attachment - skill_listing 附件
 * @returns 格式化后的消息内容
 */
export function formatSkillListingMessage(
  attachment: SkillListingAttachment
): string {
  const header = attachment.isInitial
    ? 'The following skills are available for use with the Skill tool:'
    : 'New skills are now available for use with the Skill tool:';

  return `${header}\n\n${attachment.content}`;
}

/**
 * 检查是否应该发送 skill_listing
 *
 * @param skills - 技能列表
 * @param sessionKey - session 唯一标识
 * @returns 是否有新技能需要发送
 */
export function shouldSendSkillListing(
  skills: Skill[],
  sessionKey: string
): boolean {
  const visibleSkills = filterVisibleSkills(skills);
  const newSkills = getNewSkills(sessionKey, visibleSkills);
  return newSkills.length > 0;
}