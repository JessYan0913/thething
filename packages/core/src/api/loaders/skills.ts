// ============================================================
// Skills Loader
// ============================================================

import { parseFrontmatterFile } from '../../foundation/parser';
import { scanConfigDirs, mergeByPriority, LoadingCache } from '../../foundation/scanner';
import { getUserConfigDir, getProjectConfigDir, computeUserConfigDir, computeProjectConfigDir, resolveHomeDir } from '../../foundation/paths';
import type { z } from 'zod';
import type { Skill, SkillMetadata, SkillLoaderConfig } from '../../extensions/skills/types';
import { SkillFrontmatterSchema } from '../../extensions/skills/types';

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
  /** 配置目录名（可选，默认 '.thething'） */
  configDirName?: string;
}

// ============================================================
// 核心加载函数
// ============================================================

/**
 * 加载 Skills 配置
 */
export async function loadSkills(options?: LoadSkillsOptions): Promise<Skill[]> {
  const cwd = options?.cwd ?? process.cwd();
  const sources = options?.sources ?? ['user', 'project'];
  const configDirName = options?.configDirName ?? '.thething';
  const homeDir = resolveHomeDir();

  // 检查缓存
  const cacheKey = `skills:${cwd}:${configDirName}`;
  const cached = skillsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 构建扫描目录（使用 configDirName）
  const dirs: string[] = [];
  if (sources.includes('user')) {
    dirs.push(computeUserConfigDir(homeDir, 'skills', configDirName));
  }
  if (sources.includes('project')) {
    dirs.push(computeProjectConfigDir(cwd, 'skills', configDirName));
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

  // 去除 source 字段，返回纯 Skill（保留 source 用于附件过滤）
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
    source: s.source, // 保留 source 字段用于附件过滤
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

// ============================================================
// 兼容接口（原 extensions/skills/loader.ts）
// ============================================================

/**
 * 加载单个 Skill 文件（兼容接口）
 *
 * @param skillPath Skill 文件路径
 * @returns Skill 对象
 */
export async function loadSkill(skillPath: string): Promise<Skill> {
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
 * 扫描 Skills 配置目录（兼容接口）
 *
 * @param cwd 当前工作目录
 * @param _config 加载配置（已弃用，保留签名兼容）
 * @returns Skill 列表
 */
export async function scanSkillsDirs(
  cwd?: string,
  _config?: Partial<SkillLoaderConfig>,
): Promise<Skill[]> {
  return loadSkills({ cwd });
}

/**
 * 获取所有可用 Skills（兼容接口）
 *
 * @param cwd 当前工作目录
 * @param _config 加载配置（已弃用，保留签名兼容）
 * @returns Skill 列表
 */
export async function getAvailableSkills(
  cwd?: string,
  _config?: Partial<SkillLoaderConfig>,
): Promise<Skill[]> {
  return scanSkillsDirs(cwd);
}