import { minimatch } from 'minimatch';
import type { Skill, SkillMetadata } from './types';
import { getAvailableSkillsMetadata } from './metadata-loader';
import { loadFullSkill } from './body-loader';
import { recordSkillUsage } from './usage-tracking';

const conditionalSkillsCache = new Map<string, Skill>();

export async function activateConditionalSkills(filePaths: string[]): Promise<{ activated: Skill[]; alreadyActive: string[] }> {
  if (filePaths.length === 0) {
    return { activated: [], alreadyActive: [] };
  }

  const skillsMetadata = await getAvailableSkillsMetadata();
  const conditionalSkills = skillsMetadata.filter((s) => s.paths.length > 0);

  if (conditionalSkills.length === 0) {
    return { activated: [], alreadyActive: [] };
  }

  const activated: Skill[] = [];
  const alreadyActive: string[] = [];

  for (const skill of conditionalSkills) {
    const isMatch = matchesAnyPath(filePaths, skill.paths);
    if (!isMatch) continue;

    if (conditionalSkillsCache.has(skill.name)) {
      alreadyActive.push(skill.name);
      continue;
    }

    try {
      const fullSkill = await loadFullSkill(skill);
      conditionalSkillsCache.set(skill.name, fullSkill);
      activated.push(fullSkill);
      recordSkillUsage(skill.name);
    } catch (error) {
      console.warn(`[ConditionalActivation] Failed to load skill ${skill.name}: ${(error as Error).message}`);
    }
  }

  return { activated, alreadyActive };
}

export function matchesAnyPath(filePaths: string[], skillPaths: string[]): boolean {
  for (const filePath of filePaths) {
    for (const pattern of skillPaths) {
      if (minimatch(filePath, pattern, { dot: true, nocase: true })) {
        return true;
      }
      if (filePath.endsWith(pattern.replace(/\*\*\/?/g, '')) || pattern.includes(filePath)) {
        return true;
      }
    }
  }
  return false;
}

export function formatConditionalSkillActivation(activated: Skill[]): string {
  if (activated.length === 0) return '';

  const sections = activated
    .map((s) => `<技能指令 name="${s.name}">\n${s.body}\n</技能指令>`)
    .join('\n\n');

  return `## 条件激活技能

根据当前操作的文件路径，以下技能已自动激活：

${sections}`;
}

export function resetConditionalActivationCache(): void {
  conditionalSkillsCache.clear();
}

export function getActiveConditionalSkills(): Skill[] {
  return Array.from(conditionalSkillsCache.values());
}
