// ============================================================
// Skills Loader - 基于 MultiSourceConfigLoader
// ============================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { parseFrontmatterFile } from '../../primitives/parser';
import { createMultiSourceLoader } from '../../services/scanner/multi-source-loader';
import type { Skill, SkillLoaderConfig } from './types';
import { SkillFrontmatterSchema } from './types';
import type { ConfigSource } from '../../primitives/constants';
import { BUNDLED_SKILLS } from './bundled';
import { logger } from '../../primitives/logger';

// ============================================================
// 扩展类型（带 source 字段）
// ============================================================

interface SkillWithSource extends Skill {
  source: ConfigSource;
}

// ============================================================
// 辅助函数：生成目录树结构
// ============================================================

/**
 * 生成目录树结构（字符串格式）
 *
 * @param dirPath - 目录路径
 * @param prefix - 前缀（用于递归缩进）
 * @returns 目录树字符串
 */
async function generateDirTree(dirPath: string, prefix: string = ''): Promise<string> {
  const lines: string[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // 排序：目录在前，文件在后，按名称排序
    const sortedEntries = entries
      .filter(e => !e.name.startsWith('.')) // 跳过隐藏文件
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      const isLast = i === sortedEntries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        const subTree = await generateDirTree(fullPath, prefix + childPrefix);
        if (subTree) {
          lines.push(subTree);
        }
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }
  } catch (error) {
    logger.warn('SkillLoader', `Failed to read directory ${dirPath}: ${(error as Error).message}`);
  }

  return lines.join('\n');
}

// ============================================================
// MultiSource Loader
// ============================================================

const skillsLoader = createMultiSourceLoader<SkillWithSource>({
  subcategory: 'skills',
  filePattern: 'SKILL.md',
  filePatterns: ['SKILL.md', 'skill.md'],
  scanMode: 'configDir',
  dirPattern: '*',
  priorityOrder: ['project', 'user', 'builtin'],
  parse: async (filePath, source) => {
    const result = await parseFrontmatterFile(filePath, SkillFrontmatterSchema);

    // 协议兼容：id 作为技能标识，fallback 到 name
    const skillName = result.data.id ?? result.data.name;

    // 生成技能目录树结构
    const skillDir = path.dirname(filePath);
    const dirTree = await generateDirTree(skillDir);

    return {
      name: skillName,
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
      dirTree: dirTree || undefined,
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
    dirTree: s.dirTree,
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

  // 生成技能目录树结构
  const skillDir = path.dirname(filePath);
  const dirTree = await generateDirTree(skillDir);

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
    dirTree: dirTree || undefined,
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
    dirTree: result.dirTree,
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
