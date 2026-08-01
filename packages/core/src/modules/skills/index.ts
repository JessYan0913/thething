/**
 * Skills 模块入口
 *
 * 简化版：移除 TF-IDF 搜索相关模块，保留基础加载功能。
 * 技能现在通过 Skill 工具主动调用。
 */

export type { Skill, SkillFrontmatter, SkillMetadata, SkillLoaderConfig } from './types';

export { DEFAULT_SKILL_LOADER_CONFIG, SkillFrontmatterSchema } from './types';

// 从模块内部 loader 导出（消除 modules → composition 反向依赖）
export {
  loadSkills,
  loadSkill,
  loadSkillFile,
  scanSkillsDirs,
  getAvailableSkills,
  generateSkillDirTree,
  readSkillBody,
  type LoadSkillsOptions,
} from './loader';

export {
  SKILL_BUDGET_CONFIG,
  getCharBudget,
  truncateDescription,
  formatSkillsWithinBudget,
  estimateFormattedChars,
  estimateTokensFromChars,
} from './budget-formatter';

export {
  DEFAULT_RESIDENT_LIMIT,
  MAX_RESIDENT_ENTRY_CHARS,
  selectResidentSet,
  formatResidentSections,
  getSessionSkillResidentSet,
  clearSessionSkillResidentSetCache,
  type ResidentSetOptions,
  type ResidentSetResult,
} from './resident-set';

export {
  loadSkillPreferences,
  EMPTY_SKILL_PREFERENCES,
  type SkillPreferences,
} from './preferences';

export {
  loadSkillUsage,
  recordSkillUsage,
  usageScore,
  type SkillUsageEntry,
  type SkillUsageMap,
} from './usage';

export const SKILLS_MODULE_VERSION = '2.0.0';