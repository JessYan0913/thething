import type { Skill, SkillLoaderConfig } from './types';
import { DEFAULT_SKILL_LOADER_CONFIG, SkillFrontmatterSchema } from './types';
import { parseFrontmatterFile, scanConfigDirs, getUserConfigDir, getProjectConfigDir } from '../loading';

export async function loadSkill(skillPath: string): Promise<Skill> {
  const result = await parseFrontmatterFile(skillPath, SkillFrontmatterSchema);

  return {
    name: result.data.name,
    description: result.data.description,
    whenToUse: result.data.whenToUse,
    allowedTools: result.data.allowedTools,
    model: result.data.model,
    effort: result.data.effort,
    context: result.data.context,
    paths: result.data.paths,
    body: result.body,
    sourcePath: result.filePath,
  };
}

export async function scanSkillsDirs(cwd?: string, config?: Partial<SkillLoaderConfig>): Promise<Skill[]> {
  const resolvedConfig: SkillLoaderConfig = {
    ...DEFAULT_SKILL_LOADER_CONFIG,
    ...config,
  };

  const effectiveCwd = cwd ?? process.cwd();

  // 构建扫描目录列表
  const dirs: string[] = [
    getUserConfigDir('skills'),
    getProjectConfigDir(effectiveCwd, 'skills'),
  ];

  // 使用 loading 模块的扫描器
  const scanResults = await scanConfigDirs(effectiveCwd, {
    dirs,
    filePattern: 'SKILL.md',
    dirPattern: '*',
  });

  const skills: Skill[] = [];
  const seen = new Set<string>();

  for (const result of scanResults) {
    if (seen.has(result.filePath)) continue;
    seen.add(result.filePath);

    try {
      const skill = await loadSkill(result.filePath);

      // 跳过重复名称
      if (skills.some((s) => s.name === skill.name)) {
        continue;
      }

      skills.push(skill);

      if (resolvedConfig.maxSkills && skills.length >= resolvedConfig.maxSkills) {
        break;
      }
    } catch (error) {
      console.warn(`[SkillLoader] Failed to load skill from ${result.filePath}: ${(error as Error).message}`);
    }
  }

  return skills;
}

let skillsCache: Skill[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export async function getAvailableSkills(cwd?: string, config?: Partial<SkillLoaderConfig>): Promise<Skill[]> {
  const now = Date.now();

  if (skillsCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return skillsCache;
  }

  skillsCache = await scanSkillsDirs(cwd, config);
  cacheTimestamp = now;

  return skillsCache;
}

export function clearSkillsCache(): void {
  skillsCache = null;
  cacheTimestamp = 0;
}