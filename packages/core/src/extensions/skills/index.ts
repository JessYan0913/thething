export type { Skill, SkillFrontmatter, SkillLoaderConfig, SkillUsageRecord, SkillMetadata } from './types';

export { DEFAULT_SKILL_LOADER_CONFIG, DEFAULT_SKILL_SCAN_DIRS, SkillFrontmatterSchema } from './types';

export { clearSkillsCache, getAvailableSkills, loadSkill, scanSkillsDirs } from './loader';

export { getAvailableSkillsMetadata, clearMetadataCache } from './metadata-loader';

export { loadFullSkill, loadSkillBody, preloadSkillBodies, clearAllBodyCache, evictSkillBody, getBodyCacheStats } from './body-loader';

// 旧的注入函数已移除，使用 attachments 模块的 getSkillListingAttachment/getTurnZeroSkillDiscovery
export { formatFullSkillsContent } from './prompt-injection';

export { activateConditionalSkills, matchesAnyPath, formatConditionalSkillActivation, resetConditionalActivationCache, getActiveConditionalSkills } from './conditional-activation';

export { getHalfLifeHours, getRankedSkills, getSkillUsage, recordSkillUsage, resetSkillUsage } from './usage-tracking';

export {
  SKILL_BUDGET_CONFIG,
  getCharBudget,
  truncateDescription,
  formatSkillsWithinBudget,
  estimateFormattedChars,
  estimateTokensFromChars,
} from './budget-formatter';

export const SKILLS_MODULE_VERSION = '1.0.0';