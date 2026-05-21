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

export const SKILLS_MODULE_VERSION = '2.0.0';