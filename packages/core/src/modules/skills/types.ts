import { z } from 'zod';

// 从统一配置模块导入常量
import {
  DEFAULT_SKILL_LOADER_CONFIG,
} from '../../services/config/defaults';

// 重新导出供其他模块使用
export { DEFAULT_SKILL_LOADER_CONFIG };

const XML_TAG_PATTERN = /<\/?[A-Za-z][^>]*>/;
const RESERVED_SKILL_NAME_PATTERN = /(anthropic|claude)/;

const StandardSkillNameSchema = z
  .string()
  .min(1, 'Skill name is required')
  .max(64, 'Skill name must be 64 characters or fewer')
  .regex(/^[a-z0-9-]+$/, 'Skill name may contain only lowercase letters, numbers, and hyphens')
  .refine((name) => !XML_TAG_PATTERN.test(name), 'Skill name must not contain XML tags')
  .refine(
    (name) => !RESERVED_SKILL_NAME_PATTERN.test(name),
    'Skill name must not contain reserved words "anthropic" or "claude"',
  );

const StandardSkillDescriptionSchema = z
  .string()
  .trim()
  .min(1, 'Skill description is required')
  .max(1024, 'Skill description must be 1024 characters or fewer')
  .refine(
    (description) => !XML_TAG_PATTERN.test(description),
    'Skill description must not contain XML tags',
  );

export type SkillEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Anthropic Agent Skills standard fields are `name` and `description`.
 * The remaining fields are optional TheThing / Claude Code compatibility
 * extensions. They intentionally have no schema defaults: parsing a standard
 * minimal SKILL.md must not synthesize product-specific frontmatter.
 */
export const SkillFrontmatterSchema = z.object({
  name: StandardSkillNameSchema,
  description: StandardSkillDescriptionSchema,
  id: z.string().optional(),
  whenToUse: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  context: z.enum(['inline', 'fork']).optional(),
  agent: z.string().min(1).optional(),
  background: z.boolean().optional(),
  paths: z.array(z.string()).optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface SkillMetadata {
  name: string;
  description: string;
  /** Optional TheThing compatibility extensions. */
  whenToUse?: string;
  allowedTools?: string[];
  model?: string;
  effort?: SkillEffort;
  context?: 'inline' | 'fork';
  agent?: string;
  background?: boolean;
  paths?: string[];
  sourcePath: string;
  source?: string;  // 来源：bundled, mcp, project, user
  /** 技能目录结构（文件列表） */
  dirTree?: string;
}

export interface Skill extends SkillMetadata {
  /** 技能指令主体。在 bulk load 时为 undefined，通过 skill tool 按需加载 */
  body?: string;
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