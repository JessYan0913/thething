// ============================================================
// Skills Metadata Loader - 统一加载器代理
// ============================================================
//
// 改造说明：此文件代理到 loaders/skills.ts，只返回 metadata 部分
//

import {
  loadSkills,
  clearSkillsCache,
} from '../loaders/skills';
import type { SkillMetadata, SkillLoaderConfig } from './types';

/**
 * 获取所有可用 Skills 的 Metadata（不含 body）
 *
 * @param config 加载配置（cwd 等）
 * @returns SkillMetadata 列表
 */
export async function getAvailableSkillsMetadata(
  config?: Partial<SkillLoaderConfig>,
): Promise<SkillMetadata[]> {
  const skills = await loadSkills({ cwd: config?.cwd });

  // 只返回 metadata 部分（不含 body）
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    whenToUse: s.whenToUse,
    allowedTools: s.allowedTools,
    model: s.model,
    effort: s.effort,
    context: s.context,
    paths: s.paths,
    sourcePath: s.sourcePath,
  }));
}

/**
 * 清除 Metadata 缓存（代理到 skillsCache）
 */
export function clearMetadataCache(): void {
  clearSkillsCache();
}