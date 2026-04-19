import fs from 'fs/promises';
import matter from 'gray-matter';
import path from 'path';
import type { Skill, SkillFrontmatter, SkillLoaderConfig } from './types';
import { DEFAULT_SKILL_LOADER_CONFIG, SkillFrontmatterSchema } from './types';

export async function loadSkill(skillPath: string): Promise<Skill> {
  const content = await fs.readFile(skillPath, 'utf-8');
  const { data, content: body } = matter(content);

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
    body: body.trim(),
    sourcePath: path.resolve(skillPath),
  };
}

function validateFrontmatter(data: unknown): SkillFrontmatter {
  const result = SkillFrontmatterSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid skill frontmatter: ${errors}`);
  }

  return result.data;
}

export async function scanSkillsDirs(config?: Partial<SkillLoaderConfig>): Promise<Skill[]> {
  const resolvedConfig: SkillLoaderConfig = {
    ...DEFAULT_SKILL_LOADER_CONFIG,
    ...config,
  };

  const skills: Skill[] = [];
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
        if (seen.has(skillFile)) continue;
        seen.add(skillFile);

        try {
          const skill = await loadSkill(skillFile);

          const duplicate = skills.find((s) => s.name === skill.name);
          if (duplicate) {
            continue;
          }

          skills.push(skill);

          if (resolvedConfig.maxSkills && skills.length >= resolvedConfig.maxSkills) {
            return skills;
          }
        } catch (error) {
          console.warn(`[SkillLoader] Failed to load skill from ${skillFile}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      console.debug(`[SkillLoader] Scan directory not found: ${absoluteDir}`);
    }
  }

  return skills;
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

let skillsCache: Skill[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export async function getAvailableSkills(config?: Partial<SkillLoaderConfig>): Promise<Skill[]> {
  const now = Date.now();

  if (skillsCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return skillsCache;
  }

  skillsCache = await scanSkillsDirs(config);
  cacheTimestamp = now;

  return skillsCache;
}

export function clearSkillsCache(): void {
  skillsCache = null;
  cacheTimestamp = 0;
}