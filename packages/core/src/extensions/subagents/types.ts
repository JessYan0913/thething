import { z } from 'zod';
import type { LanguageModel, StopCondition, ToolSet, UIMessage } from 'ai';
import type { TaskStore } from '../../runtime/tasks';
import { PROJECT_CONFIG_DIR_NAME } from '../../config/defaults';

// ============================================================
// Agent Frontmatter Schema（用于解析 .md 文件）
// ============================================================

/**
 * Agent Markdown 文件的 Frontmatter Schema
 */
export const AgentFrontmatterSchema = z.object({
  // 标识（支持 name 或 agentType）
  name: z.string().min(1).max(50).describe('Agent 标识（agentType）').optional(),
  agentType: z.string().min(1).max(50).describe('Agent 标识').optional(),
  displayName: z.string().describe('显示名称').optional(),

  // 描述（必填）
  description: z.string().min(1).describe('Agent 描述'),

  // 工具控制
  tools: z.union([z.string(), z.array(z.string())]).optional().describe('允许的工具列表'),
  disallowedTools: z.union([z.string(), z.array(z.string())]).optional().describe('禁止的工具列表'),

  // 模型配置
  model: z.enum(['inherit', 'fast', 'smart']).or(z.string()).optional().describe('模型选择'),
  effort: z.enum(['low', 'medium', 'high']).optional().describe('推理努力程度'),

  // 行为控制
  maxTurns: z.number().int().min(1).max(100).optional().describe('最大轮次'),
  permissionMode: z.enum(['acceptEdits', 'plan', 'bypassPermissions']).optional().describe('权限模式'),
  background: z.boolean().optional().describe('是否后台运行'),
  initialPrompt: z.string().optional().describe('首轮提示前缀'),

  // 隔离与持久化
  isolation: z.enum(['worktree']).optional().describe('隔离模式'),
  memory: z.enum(['user', 'project', 'local']).optional().describe('记忆范围'),

  // Skills
  skills: z.union([z.string(), z.array(z.string())]).optional().describe('预加载 Skills'),

  // 来源与上下文
  source: z.enum(['builtin', 'user', 'project', 'plugin']).optional().describe('来源'),
  includeParentContext: z.boolean().optional().describe('是否继承父 Agent 上下文'),
  maxParentMessages: z.number().int().min(1).optional().describe('父消息最大数量'),
  summarizeOutput: z.boolean().optional().describe('是否输出摘要'),

  // 元数据（扩展字段容器）
  metadata: z.record(z.string(), z.unknown()).optional().describe('元数据'),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

// ============================================================
// Agent Definition（运行时定义）
// ============================================================

export type PermissionMode = 'acceptEdits' | 'plan' | 'bypassPermissions';

export type AgentSource = 'builtin' | 'user' | 'project' | 'plugin';

/**
 * Agent 定义（统一格式）
 *
 * 来源：
 * - builtin: 硬编码 TypeScript（built-in/*.ts）
 * - user: 用户全局目录（~/${PROJECT_CONFIG_DIR_NAME}/agents/*.md）
 * - project: 项目目录（${PROJECT_CONFIG_DIR_NAME}/agents/*.md）
 * - plugin: 插件系统注册
 */
export interface AgentDefinition {
  /** Agent 标识 */
  agentType: string;

  /** Agent 描述 */
  description: string;

  /** 允许的工具列表 */
  tools?: string[];

  /** 禁止的工具列表 */
  disallowedTools?: string[];

  /** 模型配置 */
  model?: 'inherit' | 'fast' | 'smart' | string | LanguageModel;

  /** 推理努力程度 */
  effort?: 'low' | 'medium' | 'high' | number;

  /** 最大轮次 */
  maxTurns?: number;

  /** 权限模式 */
  permissionMode?: PermissionMode;

  /** 是否后台运行 */
  background?: boolean;

  /** 首轮提示前缀 */
  initialPrompt?: string;

  /** 隔离模式 */
  isolation?: 'worktree';

  /** 记忆范围 */
  memory?: 'user' | 'project' | 'local';

  /** 预加载 Skills */
  skills?: string[];

  /** System Prompt（来自 Markdown 正文或 TypeScript 定义） */
  instructions: string;

  /** 是否继承父 Agent 上下文 */
  includeParentContext?: boolean;

  /** 父消息最大数量 */
  maxParentMessages?: number;

  /** 是否输出摘要 */
  summarizeOutput?: boolean;

  /** 自定义停止条件 */
  stopWhen?: StopCondition<ToolSet>[];

  /** 来源 */
  source: AgentSource;

  /** 文件路径（仅 Markdown 来源） */
  filePath?: string;

  /** 元数据 */
  metadata?: Record<string, unknown>;

  /** 显示名称 */
  displayName?: string;
}

// ============================================================
// Agent Execution Context
// ============================================================

export type SubAgentStreamWriter = {
  write: (chunk: Record<string, unknown>) => void;
};

/**
 * Agent 执行上下文
 */
export interface AgentExecutionContext {
  /** 父 Agent 的工具池 */
  parentTools: ToolSet;

  /** 父 Agent 的模型 */
  parentModel: LanguageModel;

  /** 父 Agent 的 System Prompt */
  parentSystemPrompt: string;

  /** 父 Agent 的消息历史 */
  parentMessages: UIMessage[];

  /** 输出流写入器 */
  writerRef: { current: SubAgentStreamWriter | null };

  /** 中止信号 */
  abortSignal: AbortSignal;

  /** 工具调用 ID */
  toolCallId: string;

  /** 递归深度 */
  recursionDepth: number;

  /** 任务存储 */
  taskStore?: TaskStore;

  /** 任务 ID */
  taskId?: string;

  /** 模型提供者（用于创建子代理模型） */
  provider?: (modelName: string) => LanguageModel;

  /** 工作目录 */
  cwd?: string;
}

// ============================================================
// Agent Execution Result
// ============================================================

export interface TokenUsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type AgentExecutionStatus = 'completed' | 'failed' | 'aborted' | 'recursion-blocked';

/**
 * Agent 执行结果
 */
export interface AgentExecutionResult {
  /** 是否成功 */
  success: boolean;

  /** 结果摘要 */
  summary: string;

  /** 执行时长（毫秒） */
  durationMs: number;

  /** Token 使用统计 */
  tokenUsage?: TokenUsageStats;

  /** 执行轮次 */
  stepsExecuted: number;

  /** 使用的工具 */
  toolsUsed: string[];

  /** 错误信息 */
  error?: string;

  /** 执行状态 */
  status: AgentExecutionStatus;

  /** Worktree 路径（如有隔离） */
  worktreePath?: string;

  /** Worktree 分支（如有隔离） */
  worktreeBranch?: string;
}

// ============================================================
// Agent Tool Input/Output
// ============================================================

export interface AgentToolInput {
  /** Agent 类型（可选，自动路由时不需要） */
  agentType?: string;

  /** 任务描述 */
  task: string;
}

export interface AgentToolConfig {
  /** 父工具池 */
  parentTools: ToolSet;

  /** 父模型 */
  parentModel: LanguageModel;

  /** 父 System Prompt */
  parentSystemPrompt: string;

  /** 父消息历史 */
  parentMessages: UIMessage[];

  /** 输出流写入器 */
  writerRef: { current: SubAgentStreamWriter | null };

  /** 递归深度 */
  recursionDepth?: number;

  /** 任务存储 */
  taskStore?: TaskStore;

  /** 任务 ID */
  taskId?: string;

  /** 工作目录 */
  cwd?: string;

  /** 模型提供者 */
  provider?: (modelName: string) => LanguageModel;
}

// ============================================================
// Agent Route Decision
// ============================================================

export type AgentRouteType = 'named' | 'context' | 'general' | 'blocked';

/**
 * Agent 路由决策
 */
export interface AgentRouteDecision {
  /** 路由类型 */
  type: AgentRouteType;

  /** Agent 定义 */
  definition: AgentDefinition;

  /** 路由原因 */
  reason: string;
}

// ============================================================
// Re-export from AI SDK types
// ============================================================

export type { LanguageModel, ToolSet, UIMessage, StopCondition };