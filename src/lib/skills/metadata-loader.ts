import fs from 'fs/promises';
import matter from 'gray-matter';
import path from 'path';
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

async function scanMetadataDirs(config?: Partial<SkillLoaderConfig>): Promise<SkillMetadata[]> {
  const resolvedConfig: SkillLoaderConfig = {
    ...DEFAULT_SKILL_LOADER_CONFIG,
    ...config,
  };

  const skills: SkillMetadata[] = [];
  const seen = new Set<string>();

  for (const scanDir of resolvedConfig.scanDirs) {
    const absoluteDir = path.resolve(process.cwd(), scanDir);

    try {
      const exists = await fs.stat(absoluteDir).catch(() => null);
      if (!exists || !exists.isDirectory()) {
        continue;
      }

      const skillFiles = await findSkillFiles(absoluteDir);

      for (const skillFile of skillFiles) {
        const realPath = path.resolve(skillFile);
        if (seen.has(realPath)) continue;
        seen.add(realPath);

        try {
          const skill = await loadSkillMetadataOnly(skillFile);

          const duplicate = skills.find((s) => s.name === skill.name);
          if (duplicate) {
            continue;
          }

          skills.push(skill);

          if (resolvedConfig.maxSkills && skills.length >= resolvedConfig.maxSkills) {
            return skills;
          }
        } catch (error) {
          console.warn(`[SkillMetadataLoader] Failed to load skill from ${skillFile}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      console.debug(`[SkillMetadataLoader] Scan directory not found: ${absoluteDir}`);
    }
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

  metadataCache = await scanMetadataDirs(config);
  cacheTimestamp = now;

  return metadataCache;
}

export function clearMetadataCache(): void {
  metadataCache = null;
  cacheTimestamp = 0;
}
