// ============================================================
// Skills Loader - 基于 MultiSourceConfigLoader
// ============================================================

import { parseFrontmatterFile } from '../../primitives/parser';
import { createMultiSourceLoader } from '../../services/scanner/multi-source-loader';
import type { Skill, SkillLoaderConfig } from './types';
import { SkillFrontmatterSchema } from './types';
import type { ConfigSource } from '../../primitives/constants';

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
  configDirName?: string;
  homeDir?: string;
}

export async function loadSkills(options?: LoadSkillsOptions): Promise<Skill[]> {
  const items = await skillsLoader.load({
    cwd: options?.cwd,
    configDirName: options?.configDirName,
    homeDir: options?.homeDir,
    dirs: options?.dirs,
  });

  return items.map((s) => ({
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

export function clearSkillsCache(): void {
  skillsLoader.clearCache();
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
