// ============================================================
// Skills Loader
// ============================================================

import { parseFrontmatterFile } from '../parser';
import { scanConfigDirs, mergeByPriority, LoadingCache } from '../scanner';
import { detectProjectDir, getUserConfigDir, getProjectConfigDir } from '../paths';
import type { z } from 'zod';
import type { Skill, SkillMetadata } from '../skills/types';
import { SkillFrontmatterSchema } from '../skills/types';

// ============================================================
// 扩展类型（带 source 字段）
// ============================================================

interface SkillWithSource extends Skill {
  source: 'user' | 'project';
}

// ============================================================
// 缓存
// ============================================================

const skillsCache = new LoadingCache<Skill[]>();

// ============================================================
// 加载选项
// ============================================================

export interface LoadSkillsOptions {
  cwd?: string;
  sources?: ('user' | 'project')[];
}

// ============================================================
// 加载函数
// ============================================================

/**
 * 加载 Skills 配置
 *
 * @param options 加载选项
 * @returns Skill 列表
 */
export async function loadSkills(options?: LoadSkillsOptions): Promise<Skill[]> {
  const cwd = options?.cwd ?? detectProjectDir();
  const sources = options?.sources ?? ['user', 'project'];

  // 检查缓存
  const cacheKey = `skills:${cwd}`;
  const cached = skillsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 构建扫描目录
  const dirs: string[] = [];
  if (sources.includes('user')) {
    dirs.push(getUserConfigDir('skills'));
  }
  if (sources.includes('project')) {
    dirs.push(getProjectConfigDir(cwd, 'skills'));
  }

  // 扫描目录 - 使用 scanConfigDirs 支持 dirPattern
  // Skills 目录结构：{skillName}/SKILL.md
  const scanResults = await scanConfigDirs(cwd, {
    dirs,
    filePattern: 'SKILL.md',
    dirPattern: '*',
    recursive: false,
  });

  // 加载每个文件
  const skills: SkillWithSource[] = [];
  for (const result of scanResults) {
    try {
      const skill = await loadSkillFile(result.filePath, result.source);
      skills.push(skill);
    } catch (error) {
      console.warn(`[SkillsLoader] Failed to load ${result.filePath}: ${(error as Error).message}`);
    }
  }

  // 合并（project > user）
  const merged = mergeByPriority(
    skills,
    ['project', 'user'],
    (s) => s.name,
  );

  // 去除 source 字段，返回纯 Skill
  const result: Skill[] = merged.map((s) => ({
    name: s.name,
    description: s.description,
    whenToUse: s.whenToUse,
    allowedTools: s.allowedTools,
    model: s.model,
    effort: s.effort,
    context: s.context,
    paths: s.paths,
    sourcePath: s.sourcePath,
    body: s.body,
  }));

  // 更新缓存
  skillsCache.set(cacheKey, result);

  return result;
}

/**
 * 加载单个 Skill 文件
 *
 * @param filePath 文件路径
 * @param source 来源
 * @returns Skill with source
 */
export async function loadSkillFile(
  filePath: string,
  source: 'user' | 'project',
): Promise<SkillWithSource> {
  const result = await parseFrontmatterFile(filePath, SkillFrontmatterSchema);

  return {
    name: result.data.name,
    description: result.data.description,
    whenToUse: result.data.whenToUse,
    allowedTools: result.data.allowedTools,
    model: result.data.model,
    effort: result.data.effort,
    context: result.data.context,
    paths: result.data.paths,
    sourcePath: result.filePath,  // ParseResult.filePath 是 string
    body: result.body,
    source,
  };
}

/**
 * 清除缓存
 */
export function clearSkillsCache(): void {
  skillsCache.clear();
}