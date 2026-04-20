import { z } from 'zod';

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().min(1),
  whenToUse: z.string().optional(),
  allowedTools: z.array(z.string()).default([]),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  context: z.enum(['inline', 'fork']).default('inline'),
  paths: z.array(z.string()).default([]),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface SkillMetadata {
  name: string;
  description: string;
  whenToUse?: string;
  allowedTools: string[];
  model?: string;
  effort: 'low' | 'medium' | 'high';
  context: 'inline' | 'fork';
  paths: string[];
  sourcePath: string;
}

export interface Skill extends SkillMetadata {
  body: string;
}

export interface SkillUsageRecord {
  skillName: string;
  count: number;
  lastUsedAt: number;
  decayedScore: number;
}

export interface SkillLoaderConfig {
  scanDirs: string[];
  maxSkills?: number;
}

export const DEFAULT_SKILL_SCAN_DIRS = ['.thething/skills/'];

export const DEFAULT_SKILL_LOADER_CONFIG: SkillLoaderConfig = {
  scanDirs: DEFAULT_SKILL_SCAN_DIRS,
  maxSkills: 100,
};