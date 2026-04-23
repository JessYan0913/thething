import { z } from 'zod';

// 从统一配置模块导入常量
import {
  DEFAULT_SKILL_SCAN_DIRS,
  DEFAULT_SKILL_LOADER_CONFIG,
} from '../../config/defaults';

// 重新导出供其他模块使用
export { DEFAULT_SKILL_SCAN_DIRS, DEFAULT_SKILL_LOADER_CONFIG };

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
  source?: string;  // 来源：bundled, mcp, project, user
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
  cwd?: string;
  scanDirs: string[];
  maxSkills?: number;
}