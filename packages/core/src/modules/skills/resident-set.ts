// ============================================================
// Skill Resident Set - 常驻集选择器 + 三段式格式化
// ============================================================
//
// 设计文档：docs/skill-resident-set-design.md
//
// 技能 section 三段式：
//   A. 常驻清单（≤N 条，name + description + whenToUse，单条上限 500 字符）
//   B. 目录引导（其余技能只列名字 + find_skills 检索引导）
//   C. create-skill 引导语（由 builder.ts 追加）
//
// 常驻集选择是确定性的：优先级分层 + 层内活跃度降序 + 名字升序。
// 会话内稳定性：createAgent 每请求重建，skill-matching 是 session 缓存
// 策略的 prompt 前缀，因此选择结果以 conversationId 为键缓存在进程级，
// 同一会话内不随使用统计变化重排。使用统计只影响新会话。

import type { Skill } from './types';
import type { SkillPreferences } from './preferences';
import { EMPTY_SKILL_PREFERENCES } from './preferences';
import type { SkillUsageMap } from './usage';
import { usageScore } from './usage';
import { truncateDescription } from './budget-formatter';

/** 常驻清单条目数上限 */
export const DEFAULT_RESIDENT_LIMIT = 40;

/** 常驻条目单条字符上限（description + whenToUse 合并后；builtin/pinned 豁免） */
export const MAX_RESIDENT_ENTRY_CHARS = 500;

export interface ResidentSetOptions {
  /** 常驻条目上限，默认 40 */
  limit?: number;
  /** pinned / disabled 偏好，默认空 */
  preferences?: SkillPreferences;
  /** 使用统计，默认空 */
  usage?: SkillUsageMap;
  /** Agent 绑定白名单（优先级 1，无条件常驻）。后续 Agent skills 白名单实施时接入 */
  agentBoundSkills?: readonly string[];
  /** 打分时刻（测试注入用），默认 Date.now() */
  now?: number;
}

export interface ResidentSetResult {
  /** A 段：常驻技能（完整元数据） */
  resident: Skill[];
  /** B 段：落选技能（仅用名字） */
  catalog: Skill[];
}

/**
 * 优先级分层（数字越小越优先）：
 * 1 Agent 绑定 → 2 builtin → 3 pinned → 4 project → 5 其余（按活跃度）
 */
function priorityTier(
  skill: Skill,
  pinned: Set<string>,
  agentBound: Set<string>,
): number {
  if (agentBound.has(skill.name)) return 1;
  if (skill.source === 'builtin') return 2;
  if (pinned.has(skill.name)) return 3;
  if (skill.source === 'project') return 4;
  return 5;
}

/**
 * 选择常驻集。确定性：相同输入永远产生相同结果。
 * disabled 技能整体排除（常驻与目录都不进）。
 */
export function selectResidentSet(
  skills: readonly Skill[],
  options?: ResidentSetOptions,
): ResidentSetResult {
  const limit = options?.limit ?? DEFAULT_RESIDENT_LIMIT;
  const prefs = options?.preferences ?? EMPTY_SKILL_PREFERENCES;
  const usage = options?.usage ?? {};
  const now = options?.now ?? Date.now();

  const pinned = new Set(prefs.pinned);
  const disabled = new Set(prefs.disabled);
  const agentBound = new Set(options?.agentBoundSkills ?? []);

  const candidates = skills
    .filter((s) => !disabled.has(s.name))
    .map((s) => ({
      skill: s,
      tier: priorityTier(s, pinned, agentBound),
      score: usageScore(usage[s.name], now),
    }));

  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.score !== b.score) return b.score - a.score;
    return a.skill.name.localeCompare(b.skill.name);
  });

  return {
    resident: candidates.slice(0, limit).map((c) => c.skill),
    catalog: candidates.slice(limit).map((c) => c.skill),
  };
}

// ============================================================
// 三段式格式化
// ============================================================

function skillDescription(skill: Skill): string {
  return skill.whenToUse
    ? `${skill.description} - ${skill.whenToUse}`
    : skill.description;
}

/**
 * 格式化单条常驻条目。
 * 不携带 sourcePath（技能定位由 skill 工具按 name 完成）；
 * builtin/pinned 不截断，其余截断到 MAX_RESIDENT_ENTRY_CHARS。
 */
function formatResidentEntry(skill: Skill, pinned: Set<string>): string {
  const desc = skillDescription(skill);
  const exempt = skill.source === 'builtin' || pinned.has(skill.name);
  const finalDesc = exempt ? desc : truncateDescription(desc, MAX_RESIDENT_ENTRY_CHARS);
  const pathsInfo = skill.paths && skill.paths.length > 0
    ? ` (outputs: ${skill.paths.join(', ')})`
    : '';
  return `- ${skill.name}: ${finalDesc}${pathsInfo}`;
}

/**
 * 生成技能 section 的 A + B 段文本（C 段引导语由调用方追加）。
 */
export function formatResidentSections(
  result: ResidentSetResult,
  preferences?: SkillPreferences,
): string {
  const pinned = new Set(preferences?.pinned ?? []);
  const parts: string[] = [];

  if (result.resident.length > 0) {
    parts.push(result.resident.map((s) => formatResidentEntry(s, pinned)).join('\n'));
  }

  if (result.catalog.length > 0) {
    const names = result.catalog.map((s) => s.name).join(', ');
    parts.push(
      `其他可用技能（仅列名称）：${names}\n\n以上技能仅列出名称。需要了解详情或发现更多技能时，使用 find_skills 工具检索。`,
    );
  }

  return parts.join('\n\n');
}

// ============================================================
// 进程级会话缓存
// ============================================================

/** 缓存会话数上限（防长驻进程泄漏，超限逐出最旧条目） */
const SESSION_CACHE_LIMIT = 200;

const sessionCache = new Map<string, ResidentSetResult>();

/**
 * 以 conversationId 为键获取会话稳定的常驻集。
 * 首次调用计算并缓存，同一会话后续 createAgent 直接命中，
 * 保证 session 缓存策略的 skill-matching section 字节稳定。
 */
export function getSessionSkillResidentSet(
  conversationId: string,
  compute: () => ResidentSetResult,
): ResidentSetResult {
  const cached = sessionCache.get(conversationId);
  if (cached) return cached;

  const result = compute();
  if (sessionCache.size >= SESSION_CACHE_LIMIT) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
  sessionCache.set(conversationId, result);
  return result;
}

/** 测试用：清空会话缓存 */
export function clearSessionSkillResidentSetCache(): void {
  sessionCache.clear();
}
