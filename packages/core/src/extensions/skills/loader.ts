// ============================================================
// Skills Loader - 统一加载器代理
// ============================================================
//
// 改造说明：此文件代理到 loaders/skills.ts，保持 API 兼容
// 实际加载逻辑在 loaders/skills.ts 中
//

import {
  loadSkills,
  loadSkillFile,
  clearSkillsCache,
} from '../../api/loaders/skills';
import type { Skill, SkillLoaderConfig } from './types';

// ============================================================
// 代理函数（保持原有 API）
// ============================================================

/**
 * 加载单个 Skill 文件
 *
 * @param skillPath Skill 文件路径
 * @returns Skill 对象
 */
export async function loadSkill(skillPath: string): Promise<Skill> {
  // 假设是项目级来源（因为路径是直接传入的）
  const result = await loadSkillFile(skillPath, 'project');
  return {
    name: result.name,
    description: result.description,
    whenToUse: result.whenToUse,
    allowedTools: result.allowedTools,
    model: result.model,
    effort: result.effort,
    context: result.context,
    paths: result.paths,
    body: result.body,
    sourcePath: result.sourcePath,
  };
}

/**
 * 扫描 Skills 配置目录
 *
 * @param cwd 当前工作目录
 * @returns Skill 列表
 */
export async function scanSkillsDirs(
  cwd?: string,
  _config?: Partial<SkillLoaderConfig>,
): Promise<Skill[]> {
  return loadSkills({ cwd });
}

/**
 * 获取所有可用 Skills
 *
 * @param cwd 当前工作目录
 * @returns Skill 列表
 */
export async function getAvailableSkills(
  cwd?: string,
  _config?: Partial<SkillLoaderConfig>,
): Promise<Skill[]> {
  return scanSkillsDirs(cwd);
}

// Re-export clearSkillsCache
export { clearSkillsCache };