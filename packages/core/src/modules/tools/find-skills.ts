// ============================================================
// Find Skills Tool - 技能检索工具
// ============================================================
//
// 常驻集设计（docs/skill-resident-set-design.md）的检索通路：
// 系统提示词只常驻 ≤N 条完整描述，其余技能仅列名字，
// 模型通过本工具按关键词检索完整元数据。
//
// 89 条规模纯内存扫描即可；几百条以后按需替换实现，接口不变。

import { tool } from 'ai';
import { z } from 'zod';
import type { Skill } from '../../modules/skills/types';
import { logger } from '../../primitives/logger';

const FindSkillsInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Keywords to search for, matched against skill names and descriptions (case-insensitive)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Optional cap on how many results to return. If omitted, ALL matches are returned — the system ranks them by relevance but does not pre-filter; you decide which are relevant.'),
});

interface FindSkillsMatch {
  name: string;
  description: string;
  whenToUse?: string;
}

/**
 * 子串 + 分词匹配打分。
 * - 整句子串命中 name：100 / description+whenToUse：50
 * - 单词命中 name：20 / description+whenToUse：5（每词）
 */
function scoreSkill(skill: Skill, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const name = skill.name.toLowerCase();
  const desc = `${skill.description} ${skill.whenToUse ?? ''}`.toLowerCase();

  let score = 0;
  if (name.includes(q)) score += 100;
  if (desc.includes(q)) score += 50;

  const words = q.split(/[\s,，、/]+/).filter((w) => w.length > 1);
  for (const word of words) {
    if (name.includes(word)) score += 20;
    if (desc.includes(word)) score += 5;
  }
  return score;
}

export function createFindSkillsTool(options: {
  skills: readonly Skill[];
  /** 检索前从磁盘重扫（让会话中途新建的技能可被发现）。不传则用快照。 */
  reloadSkills?: () => Promise<readonly Skill[]>;
  /** 禁用技能名列表，不出现在检索结果中 */
  disabledSkills?: readonly string[];
}) {
  const disabled = new Set(options.disabledSkills ?? []);

  return tool({
    description: `Search the full skill catalog by keywords. The system prompt only shows detailed descriptions for a subset of skills; use this tool to discover others or to see the full description of a skill listed by name only.

Returns matching skills with name, description, and usage triggers. Invoke a found skill with the skill tool by its exact name.`,

    inputSchema: FindSkillsInputSchema,

    execute: async ({ query, limit }) => {
      // 设计决策（C2，2026-08-18）：不默认硬截断到 topK 返回。
      // find_skills 是 LLM 主动发起的检索——query 由 LLM 提供，返回的是技能
      // 元数据。默认（LLM 未显式传 limit）返回全部匹配，把"哪些匹配更相关"
      // 的选择权交还 LLM，系统只提供排序参考。仅当 LLM 显式传 limit 时才按
      // 其要求做主动裁剪（这是 LLM 自己的选择，非系统预筛）。
      const maxResults = limit !== undefined && limit > 0 ? limit : undefined;

      let skills = options.skills;
      if (options.reloadSkills) {
        try {
          skills = await options.reloadSkills();
        } catch (err) {
          logger.debug('FindSkillsTool', `Reload failed, using snapshot: ${err}`);
        }
      }

      const matches: Array<{ skill: Skill; score: number }> = [];
      for (const skill of skills) {
        if (disabled.has(skill.name)) continue;
        const score = scoreSkill(skill, query);
        if (score > 0) matches.push({ skill, score });
      }

      matches.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));

      const scored = maxResults === undefined ? matches : matches.slice(0, maxResults);
      const results: FindSkillsMatch[] = scored.map(({ skill }) => ({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
      }));

      logger.debug('FindSkillsTool', `Query "${query}" matched ${matches.length} skills, returning ${results.length}`);

      return {
        query,
        totalMatches: matches.length,
        results,
      };
    },

    toModelOutput: ({ output }) => {
      const { query, totalMatches, results } = output as {
        query: string;
        totalMatches: number;
        results: FindSkillsMatch[];
      };
      if (results.length === 0) {
        return {
          type: 'text' as const,
          value: `No skills matched "${query}". Try different keywords, or use the create-skill skill to create a new one.`,
        };
      }
      const lines = results.map((r) => {
        const wtu = r.whenToUse ? ` - ${r.whenToUse}` : '';
        return `- ${r.name}: ${r.description}${wtu}`;
      });
      const header = totalMatches > results.length
        ? `Found ${totalMatches} matching skills (showing top ${results.length}):`
        : `Found ${totalMatches} matching skill(s):`;
      return {
        type: 'text' as const,
        value: `${header}\n${lines.join('\n')}\n\nInvoke with the skill tool by exact name.`,
      };
    },
  });
}
