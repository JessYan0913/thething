export type { Skill, SkillFrontmatter, SkillLoaderConfig, SkillUsageRecord } from './types';

export { DEFAULT_SKILL_LOADER_CONFIG, DEFAULT_SKILL_SCAN_DIRS, SkillFrontmatterSchema } from './types';

export { clearSkillsCache, getAvailableSkills, loadSkill, scanSkillsDirs } from './loader';

export { determineActiveSkills, injectSkillsIntoPrompt } from './prompt-injection';

export { getHalfLifeHours, getRankedSkills, getSkillUsage, recordSkillUsage, resetSkillUsage } from './usage-tracking';

export const SKILLS_MODULE_VERSION = '1.0.0';