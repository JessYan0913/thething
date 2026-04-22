import fs from 'fs/promises';
import matter from 'gray-matter';
import path from 'path';
import { detectProjectDir, getProjectConfigDir, getUserConfigDir } from '../paths';
import type { SkillMetadata, SkillLoaderConfig } from './types';
import { DEFAULT_SKILL_LOADER_CONFIG, SkillFrontmatterSchema } from './types';

async function loadSkillMetadataOnly(skillPath: string): Promise<SkillMetadata> {
  const content = await fs.readFile(skillPath, 'utf-8');
  const { data } = matter(content);

  const frontmatter = validateFrontmatter(data);

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    whenToUse: frontmatter.whenToUse,
    allowedTools: frontmatter.allowedTools,
    model: frontmatter.model,
    effort: frontmatter.effort,
    context: frontmatter.context,
    paths: frontmatter.paths,
    sourcePath: path.resolve(skillPath),
  };
}

function validateFrontmatter(data: unknown): SkillFrontmatterType {
  const result = SkillFrontmatterSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid skill frontmatter: ${errors}`);
  }

  return result.data;
}

interface SkillFrontmatterType {
  name: string;
  description: string;
  whenToUse?: string;
  allowedTools: string[];
  model?: string;
  effort: 'low' | 'medium' | 'high';
  context: 'inline' | 'fork';
  paths: string[];
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const skillFiles: string[] = [];

  async function recurse(currentDir: string) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await recurse(fullPath);
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          skillFiles.push(fullPath);
        }
      }
    } catch {}
  }

  await recurse(dir);
  return skillFiles;
}

async function scanMetadataDirs(cwd?: string, config?: Partial<SkillLoaderConfig>): Promise<SkillMetadata[]> {
  const effectiveCwd = cwd ?? config?.cwd ?? detectProjectDir();
  const resolvedConfig: SkillLoaderConfig = {
    ...DEFAULT_SKILL_LOADER_CONFIG,
    ...config,
  };

  const skills: SkillMetadata[] = [];
  const seen = new Set<string>();

  // 用户全局目录
  const userSkillsDir = getUserConfigDir('skills');
  const userSkillFiles = await findSkillFiles(userSkillsDir);
  for (const skillFile of userSkillFiles) {
    const realPath = path.resolve(skillFile);
    if (seen.has(realPath)) continue;
    seen.add(realPath);

    try {
      const skill = await loadSkillMetadataOnly(skillFile);
      if (!skills.some(s => s.name === skill.name)) {
        skills.push(skill);
      }
    } catch (error) {
      console.warn(`[SkillMetadataLoader] Failed to load skill from ${skillFile}: ${(error as Error).message}`);
    }
  }

  // 项目级目录
  const projectSkillsDir = getProjectConfigDir(effectiveCwd, 'skills');
  const projectSkillFiles = await findSkillFiles(projectSkillsDir);
  for (const skillFile of projectSkillFiles) {
    const realPath = path.resolve(skillFile);
    if (seen.has(realPath)) continue;
    seen.add(realPath);

    try {
      const skill = await loadSkillMetadataOnly(skillFile);
      // 项目级覆盖同名的用户级技能
      const existingIndex = skills.findIndex(s => s.name === skill.name);
      if (existingIndex >= 0) {
        skills[existingIndex] = skill;
      } else {
        skills.push(skill);
      }
    } catch (error) {
      console.warn(`[SkillMetadataLoader] Failed to load skill from ${skillFile}: ${(error as Error).message}`);
    }
  }

  if (resolvedConfig.maxSkills && skills.length >= resolvedConfig.maxSkills) {
    return skills.slice(0, resolvedConfig.maxSkills);
  }

  return skills;
}

let metadataCache: SkillMetadata[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export async function getAvailableSkillsMetadata(config?: Partial<SkillLoaderConfig>): Promise<SkillMetadata[]> {
  const now = Date.now();

  if (metadataCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return metadataCache;
  }

  metadataCache = await scanMetadataDirs(undefined, config);
  cacheTimestamp = now;

  return metadataCache;
}

export function clearMetadataCache(): void {
  metadataCache = null;
  cacheTimestamp = 0;
}
