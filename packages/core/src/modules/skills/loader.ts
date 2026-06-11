// ============================================================
// Skills Loader - 基于 MultiSourceConfigLoader
// ============================================================

import { parseFrontmatterFile } from '../../primitives/parser';
import { createMultiSourceLoader } from '../../services/scanner/multi-source-loader';
import type { Skill, SkillLoaderConfig } from './types';
import { SkillFrontmatterSchema } from './types';
import type { ConfigSource } from '../../primitives/constants';
import { BUNDLED_SKILLS } from './bundled';

// ============================================================
// 扩展类型（带 source 字段）
// ============================================================

interface SkillWithSource extends Skill {
  source: ConfigSource;
}

// ============================================================
// MultiSource Loader
// ============================================================

const skillsLoader = createMultiSourceLoader<SkillWithSource>({
  subcategory: 'skills',
  filePattern: 'SKILL.md',
  scanMode: 'configDir',
  dirPattern: '*',
  priorityOrder: ['project', 'user', 'builtin'],
  parse: async (filePath, source) => {
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
      sourcePath: result.filePath,
      body: result.body,
      source,
    };
  },
  getMergeKey: (item) => item.name,
});

// ============================================================
// Public API
// ============================================================

export interface LoadSkillsOptions {
  cwd?: string;
  sources?: ('user' | 'project')[];
  dirs?: readonly string[];
  configDir?: string;
  homeDir?: string;
  builtinDir?: string;
}

export async function loadSkills(options?: LoadSkillsOptions): Promise<Skill[]> {
  // 1. 加载文件级 skills（user + project + builtin dir）
  const fileItems = await skillsLoader.load({
    cwd: options?.cwd,
    configDir: options?.configDir,
    homeDir: options?.homeDir,
    dirs: options?.dirs,
    builtinDir: options?.builtinDir,
  });

  const fileSkills = fileItems.map((s) => ({
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
    source: s.source,
  }));

  // 2. 合并内置 skills（编程式定义，最低优先级）
  //    同名时文件级 skill 覆盖内置 skill
  const allSkills = [...BUNDLED_SKILLS, ...fileSkills];
  const merged = new Map<string, Skill>();
  for (const skill of allSkills) {
    merged.set(skill.name, skill);
  }

  return Array.from(merged.values());
}

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
    sourcePath: result.filePath,
    body: result.body,
    source,
  };
}

// ============================================================
// 兼容接口
// ============================================================

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

export async function scanSkillsDirs(
  cwd?: string,
  _config?: Partial<SkillLoaderConfig>,
): Promise<Skill[]> {
  return loadSkills({ cwd });
}

export async function getAvailableSkills(
  cwd?: string,
  _config?: Partial<SkillLoaderConfig>,
): Promise<Skill[]> {
  return scanSkillsDirs(cwd);
}
