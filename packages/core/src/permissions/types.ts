/**
 * 权限系统类型定义
 */

export type PermissionBehavior = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  id: string;
  toolName: string;        // "bash", "read_file", "edit_file", "write_file"
  pattern?: string;        // "git *" for bash, "src/**" for file tools
  behavior: PermissionBehavior;
  createdAt: number;
}

export interface PermissionConfig {
  rules: PermissionRule[];
  version: number;
}

export interface PathValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath: string;
}

export interface RuleMatchResult {
  matched: boolean;
  rule?: PermissionRule;
}