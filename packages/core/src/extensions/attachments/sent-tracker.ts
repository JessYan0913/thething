/**
 * 已发送技能追踪
 *
 * 追踪已发送的技能名称，避免重复注入。
 * Key: agentId 或 sessionKey
 * Value: Set<skillName>
 */

import type { Skill } from '../skills/types';

/**
 * 已发送技能名称缓存
 */
const sentSkillNames: Map<string, Set<string>> = new Map();

/**
 * 获取已发送技能集合
 *
 * @param key - agentId 或 sessionKey
 * @returns 已发送技能名称集合
 */
export function getSentSkills(key: string): Set<string> {
  let sent = sentSkillNames.get(key);
  if (!sent) {
    sent = new Set();
    sentSkillNames.set(key, sent);
  }
  return sent;
}

/**
 * 标记单个技能为已发送
 *
 * @param key - agentId 或 sessionKey
 * @param skillName - 技能名称
 */
export function markSkillSent(key: string, skillName: string): void {
  getSentSkills(key).add(skillName);
}

/**
 * 标记多个技能为已发送
 *
 * @param key - agentId 或 sessionKey
 * @param skillNames - 技能名称数组
 */
export function markSkillsSent(key: string, skillNames: string[]): void {
  const sent = getSentSkills(key);
  for (const name of skillNames) {
    sent.add(name);
  }
}

/**
 * 清除已发送技能记录
 *
 * @param key - agentId 或 sessionKey
 */
export function clearSentSkills(key: string): void {
  sentSkillNames.delete(key);
}

/**
 * 检查技能是否是新的（未发送）
 *
 * @param key - agentId 或 sessionKey
 * @param skillName - 技能名称
 * @returns 是否是新技能
 */
export function isNewSkill(key: string, skillName: string): boolean {
  return !getSentSkills(key).has(skillName);
}

/**
 * 过滤出新技能
 *
 * @param key - agentId 或 sessionKey
 * @param skills - 技能列表
 * @returns 未发送过的新技能
 */
export function getNewSkills(key: string, skills: Skill[]): Skill[] {
  const sent = getSentSkills(key);
  return skills.filter(s => !sent.has(s.name));
}

/**
 * 获取已发送技能数量
 *
 * @param key - agentId 或 sessionKey
 * @returns 已发送技能数量
 */
export function getSentSkillCount(key: string): number {
  return getSentSkills(key).size;
}

/**
 * 检查 session 是否有已发送技能
 *
 * @param key - agentId 或 sessionKey
 * @returns 是否有已发送技能
 */
export function hasSentSkills(key: string): boolean {
  const sent = sentSkillNames.get(key);
  return sent ? sent.size > 0 : false;
}

/**
 * 清除所有已发送技能记录
 *
 * 用于全局清理，慎用。
 */
export function clearAllSentSkills(): void {
  sentSkillNames.clear();
}

/**
 * 获取所有活跃的 session keys
 *
 * @returns 所有有已发送技能的 session keys
 */
export function getActiveSessionKeys(): string[] {
  return Array.from(sentSkillNames.keys());
}