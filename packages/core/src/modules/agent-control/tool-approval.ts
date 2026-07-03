// ============================================================
// Tool Approval — 集中式工具审批逻辑
// ============================================================
// 使用 AI SDK v7 的 toolApproval + runtimeContext 机制，
// 在 ToolLoopAgent 层面统一配置所有工具的审批决策。
//
// 每个工具定义自己的审批函数，接收 input + runtimeContext，
// 返回 'approved' | 'denied' | 'user-approval'。
//
// 相比分散在各工具中的 needsApproval，这种模式：
// 1. 审批逻辑集中可读
// 2. 能访问运行时上下文（预算、拒绝历史、步数等）
// 3. 支持三态决策（之前只能 true/false）

import path from 'path';
import type { ToolApprovalStatus } from 'ai';
import { checkPermissionRules } from '../../modules/permissions';
import { isCommandDangerous, isCommandSafe } from '../../modules/tools/bash';
import type { PermissionRule } from '../../modules/permissions/types';
import { hasReviewerDenial } from './reviewer-feedback';

// ============================================================
// Runtime Context 类型
// ============================================================

export interface ApprovalRuntimeContext extends Record<string, unknown> {
  /** 当前步数 */
  turnCount: number;
  /** 项目根目录 */
  projectRoot: string;
  /** 权限规则（来自 permissions.json） */
  permissionRules: readonly PermissionRule[];
  /** 费用追踪（用于预算感知审批） */
  costTracker: {
    readonly isOverBudget: boolean;
    readonly totalCost: number;
    getSummary(): {
      remainingBudget: number;
      totalCostUsd: number;
      maxBudgetUsd: number;
      budgetUsagePercent: number;
    };
  };
  /** 拒绝追踪（用于拒绝历史感知审批） */
  denialTracker: {
    getDenialCount(toolName: string): number;
    isToolExceeded(toolName: string): boolean;
  };
  /** 审批模式：'smart' | 'auto-review' | 'full-trust' */
  approvalMode: string;
  /** auto-review 模式下的审批 Agent（由 create.ts 注入） */
  reviewer?: (toolName: string, input: unknown, messages: unknown[]) => Promise<ToolApprovalStatus>;
}

// ============================================================
// 安全路径检测
// ============================================================

const SENSITIVE_PATH_PATTERNS = ['.git', '.env', '.secret', 'node_modules'];

/** 受 toolApproval 管理的工具名称集合 */
const TOOLS_WITH_APPROVAL = new Set(['bash', 'read_file', 'write_file', 'edit_file']);

function isPathSafe(filePath: string, projectRoot: string): boolean {
  const fullPath = path.resolve(projectRoot, filePath);
  const root = path.resolve(projectRoot);
  const parentRoot = path.dirname(root);

  // 文件在项目目录内 → safe
  if (fullPath.startsWith(root)) {
    if (SENSITIVE_PATH_PATTERNS.some(p => fullPath.includes(p))) return false;
    return true;
  }

  // 文件在项目父目录内（如 monorepo 根目录下的 README）→ safe
  // 但不允许父目录是系统根目录
  if (parentRoot !== '/' && fullPath.startsWith(parentRoot)) {
    if (SENSITIVE_PATH_PATTERNS.some(p => fullPath.includes(p))) return false;
    return true;
  }

  return false;
}

// ============================================================
// 内部审批函数（按工具名称调度）
// ============================================================

async function bashApproval(
  command: string,
  ctx: ApprovalRuntimeContext,
): Promise<ToolApprovalStatus> {
  const matchedRule = checkPermissionRules('bash', { command }, ctx.permissionRules);
  if (matchedRule?.behavior === 'allow') return 'approved';
  if (matchedRule?.behavior === 'deny') return 'denied';
  if (isCommandDangerous(command).dangerous) return 'denied';
  if (ctx.denialTracker.getDenialCount('bash') >= 2) return 'user-approval';
  if (ctx.costTracker.isOverBudget) return 'user-approval';
  if (ctx.turnCount > 20) return 'user-approval';
  if (isCommandSafe(command)) return 'approved';
  return 'user-approval';
}

async function readFileApproval(
  filePath: string,
  ctx: ApprovalRuntimeContext,
): Promise<ToolApprovalStatus> {
  const matchedRule = checkPermissionRules('read_file', { filePath }, ctx.permissionRules);
  if (matchedRule?.behavior === 'allow') return 'approved';
  if (matchedRule?.behavior === 'deny') return 'denied';
  if (isPathSafe(filePath, ctx.projectRoot)) return 'approved';
  if (ctx.denialTracker.getDenialCount('read_file') >= 2) return 'user-approval';
  if (ctx.costTracker.isOverBudget) return 'user-approval';
  return 'user-approval';
}

async function writeFileApproval(
  filePath: string,
  ctx: ApprovalRuntimeContext,
): Promise<ToolApprovalStatus> {
  const matchedRule = checkPermissionRules('write_file', { filePath }, ctx.permissionRules);
  if (matchedRule?.behavior === 'allow') return 'approved';
  if (matchedRule?.behavior === 'deny') return 'denied';
  if (isPathSafe(filePath, ctx.projectRoot)) return 'approved';
  if (ctx.denialTracker.getDenialCount('write_file') >= 2) return 'user-approval';
  if (ctx.costTracker.isOverBudget) return 'user-approval';
  return 'user-approval';
}

async function editFileApproval(
  filePath: string,
  ctx: ApprovalRuntimeContext,
): Promise<ToolApprovalStatus> {
  const matchedRule = checkPermissionRules('edit_file', { filePath }, ctx.permissionRules);
  if (matchedRule?.behavior === 'allow') return 'approved';
  if (matchedRule?.behavior === 'deny') return 'denied';
  if (isPathSafe(filePath, ctx.projectRoot)) return 'approved';
  if (ctx.denialTracker.getDenialCount('edit_file') >= 2) return 'user-approval';
  if (ctx.costTracker.isOverBudget) return 'user-approval';
  return 'user-approval';
}

// ============================================================
// catchAllApproval — 兜底审批函数（GenericToolApprovalFunction）
// ============================================================
// 作为 ToolLoopAgent 的 toolApproval 入口，按 toolName 分发到各工具的审批逻辑。
// 这样避免了每个工具函数签名类型兼容性问题，且未覆盖的工具会回退到
// 'user-approval'（如果需要）或 undefined（不启用审批）。

export async function catchAllApproval(options: {
  toolCall: { toolName: string; args: unknown };
  tools: unknown;
  toolsContext: unknown;
  runtimeContext: ApprovalRuntimeContext;
  messages: unknown[];
}): Promise<ToolApprovalStatus | undefined> {
  // toolCall 结构: { toolName, input, toolCallId, ... }
  const toolCall = options.toolCall as Record<string, unknown>;
  const toolName = typeof toolCall.toolName === 'string' ? toolCall.toolName : String(toolCall.toolName ?? 'unknown');
  const input = toolCall.args ?? toolCall.input ?? toolCall.arguments;
  const ctx = options.runtimeContext;

  // ── 审批模式处理 ──────────────────────────────────────
  // 'full-trust': 所有已知工具自动放行
  if (ctx.approvalMode === 'full-trust') {
    if (TOOLS_WITH_APPROVAL.has(toolName)) return 'approved';
    return undefined;
  }

  // 'smart' / 'auto-review': 使用相同的上下文感知审批逻辑
  const decision = await runSmartDecision(toolName, input, ctx);

  // auto-review: 当决策为 user-approval 时，转交 reviewer agent
  if (decision === 'user-approval' && ctx.approvalMode === 'auto-review' && ctx.reviewer) {
    const reviewResult = await ctx.reviewer(toolName, input, options.messages);
    // B: 当 reviewer 拒绝时，如果已存储拒绝原因，让工具执行层返回详细错误
    if (reviewResult === 'denied' && hasReviewerDenial()) {
      return 'approved';
    }
    return reviewResult;
  }

  return decision;
}

// ============================================================
// runSmartDecision — Smart 模式的审批逻辑
// ============================================================

async function runSmartDecision(
  toolName: string,
  input: unknown,
  ctx: ApprovalRuntimeContext,
): Promise<ToolApprovalStatus | undefined> {
  switch (toolName) {
    case 'bash': {
      const cmd = typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>).command
        : undefined;
      if (typeof cmd === 'string') return bashApproval(cmd, ctx);
      return 'user-approval';
    }
    case 'read_file': {
      const fp = typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>).filePath
        : undefined;
      if (typeof fp === 'string') return readFileApproval(fp, ctx);
      return 'user-approval';
    }
    case 'write_file': {
      const fp = typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>).filePath
        : undefined;
      if (typeof fp === 'string') return writeFileApproval(fp, ctx);
      return 'user-approval';
    }
    case 'edit_file': {
      const fp = typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>).filePath
        : undefined;
      if (typeof fp === 'string') return editFileApproval(fp, ctx);
      return 'user-approval';
    }
    default:
      return undefined;
  }
}
