/**
 * 权限系统类型定义
 */

import { z } from 'zod';

export type PermissionBehavior = 'allow' | 'ask' | 'deny';

export const PermissionRuleSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  pattern: z.string().optional(),
  behavior: z.enum(['allow', 'ask', 'deny']),
  createdAt: z.number(),
  source: z.enum(['user', 'project']).optional(),
});

export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const PermissionConfigSchema = z.object({
  rules: z.array(PermissionRuleSchema),
  version: z.number().default(1),
});

export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;

export interface PathValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath: string;
}

export interface PathValidationOptions {
  workingDir?: string;
  extraSensitivePaths?: readonly string[];
}

export interface RuleMatchResult {
  matched: boolean;
  rule?: PermissionRule;
}
