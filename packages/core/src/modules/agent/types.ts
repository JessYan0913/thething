// ============================================================
// Agent Types - 统一的 Agent 类型定义
// ============================================================

import { z } from 'zod';
import type { LanguageModel, StopCondition, ToolSet, UIMessage } from 'ai';
import type { TodoStore } from '../../modules/todos';
import type { AgentRegistry } from './registry';
import type { SessionStateOptions, SessionState } from '../session'
import type { ModelProviderConfig } from '../../services/model'
import type { Skill } from '../../modules/skills/types'
import type { McpServerConfig } from '../../modules/mcp/types'
import type { AgentRunStore } from '../../primitives/datastore/types'
import type { BehaviorConfig } from '../../services/config/behavior'
import type { ModelAliases } from '../../services/model'
import type { ConnectorRegistry } from '../../modules/connector'
import type { ResolvedLayout } from '../../services/config/layout'
import type { ToolOutputConfig } from '../budget/tool-output-manager'
import type { CronJobStore } from '../cron/types'

// ============================================================
// Agent Frontmatter Schema（用于解析 .md 文件）
// ============================================================

/**
 * Agent Markdown 文件的 Frontmatter Schema
 *
 * 核心字段：instructions（系统提示）+ tools（工具）+ model（模型智力）
 * 能力开关：connectors / skills / mcp
 */
export const AgentFrontmatterSchema = z.object({
  // 标识（兼容 Dot Agents 协议 id + TheThing agentType）
  id: z.string().min(1).max(50).describe('协议标识').optional(),
  agentType: z.string().min(1).max(50).describe('Agent 标识').optional(),
  name: z.string().min(1).max(50).describe('备选标识').optional(),
  displayName: z.string().describe('显示名称').optional(),

  // 模型配置
  model: z.enum(['inherit', 'fast', 'smart']).or(z.string()).optional().describe('模型智力'),

  // 工具控制
  tools: z.union([z.string(), z.array(z.string())]).optional().describe('允许的系统工具'),

  // 能力开关
  connectors: z.boolean().optional().describe('是否可用连接器'),
  skills: z.boolean().optional().describe('是否可用技能'),
  mcp: z.boolean().optional().describe('是否可用 MCP 服务'),

  // 来源
  source: z.enum(['builtin', 'user', 'project', 'plugin']).optional().describe('来源'),

  // 元数据
  metadata: z.record(z.string(), z.unknown()).optional().describe('元数据'),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

// ============================================================
// Agent Definition（运行时定义）
// ============================================================

export type PermissionMode = 'acceptEdits' | 'plan' | 'bypassPermissions';

export type AgentSource = 'builtin' | 'user' | 'project' | 'plugin';

/**
 * Agent 定义（简化版）
 *
 * 核心三要素：instructions（系统提示）+ tools（工具）+ model（模型智力）
 * 能力开关：connectors / skills / mcp
 */
export interface AgentDefinition {
  /** Agent 标识 */
  agentType: string;

  /** 显示名称 */
  displayName?: string;

  /** System Prompt（核心，来自 Markdown 正文或 TypeScript 定义） */
  instructions: string;

  /** 模型智力（'inherit' | 'fast' | 'smart' 或具体模型名/LanguageModel 对象） */
  model?: 'inherit' | 'fast' | 'smart' | string | LanguageModel;

  /** 允许的系统工具 */
  tools?: string[];

  /** 是否可用连接器 */
  connectors?: boolean;

  /** 是否可用技能 */
  skills?: boolean;

  /** 是否可用 MCP 服务 */
  mcp?: boolean;

  /** 来源 */
  source: AgentSource;

  /** 文件路径（仅 Markdown 来源） */
  filePath?: string;

  /** 元数据（enabled 等） */
  metadata?: Record<string, unknown>;
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
  todoStore?: TodoStore;

  /** 任务 ID */
  todoId?: string;

  /** 模型提供者（用于创建子代理模型） */
  provider?: (modelName: string) => LanguageModel;

  /** 模型别名映射（来自 BehaviorConfig.modelAliases） */
  modelAliases?: ModelAliases;

  /** 工作目录 */
  cwd?: string;

  /** 动态重载时使用的 agents 目录布局 */
  agentsLayoutDirs?: readonly string[];

  /** 当前执行绑定的 Agent 注册表 */
  agentRegistry?: AgentRegistry;

  /** Agent run checkpoint store（仅顶层 agent 设置，子 agent 不设置） */
  agentRunStore?: AgentRunStore;

  /** 会话 ID（配合 agentRunStore 使用） */
  conversationId?: string;
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
  todoStore?: TodoStore;

  /** 任务 ID */
  todoId?: string;

  /** 工作目录 */
  cwd?: string;

  /** 模型提供者 */
  provider?: (modelName: string) => LanguageModel;

  /** 模型别名映射 */
  modelAliases?: ModelAliases;

  /** 预加载的 Agent 定义 */
  agents?: AgentDefinition[];

  /** 动态重载时使用的 agents 目录布局 */
  agentsLayoutDirs?: readonly string[];

  /** 是否允许动态重新扫描 Agent 配置 */
  dynamicReload?: boolean;

  /** 当前对话绑定的 Agent 注册表 */
  agentRegistry?: AgentRegistry;

  /** 配置目录路径（如 ~/.thething，用于工具描述文案） */
  configDir: string;
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

// ============================================================
// Agent Creation Types（原 agent/types.ts 内容）
// ============================================================

export interface AgentModules {
  skills: boolean
  mcps: boolean
  connectors: boolean
  permissions: boolean
  compaction: boolean
}

export interface ResolvedAgentConfig {
  /** 模型配置（已从 ModelConfig 转换为 ModelProviderConfig） */
  modelConfig: ModelProviderConfig
  /** 模块开关（全部已解析为 boolean，默认 true） */
  modules: AgentModules
  /** Session 参数（已完整组装：behavior 默认值 + session 覆盖 + compaction 合并） */
  sessionOptions: SessionStateOptions
  /** 行为配置（完整 BehaviorConfig，供 runtime 消费点直接取值） */
  behavior: BehaviorConfig
  /** 布局配置（已解析为绝对路径） */
  layout: ResolvedLayout
  /** 工具输出配置（已从 ToolOutputLimitsConfig 转换为 runtime 可消费对象） */
  toolOutputConfig: ToolOutputConfig
  /** 是否允许动态重载（默认 false，仅显式 opt-in 时为 true） */
  dynamicReload?: boolean
}

export interface AgentContextConfig {
  userId?: string
  teamId?: string
  conversationMeta?: {
    messageCount: number
    isNewConversation: boolean
    conversationStartTime: number
  }
}

export interface LoadToolsConfig {
  conversationId: string
  sessionState: SessionState
  enableMcp?: boolean
  enableConnector?: boolean
  connectorRegistry?: ConnectorRegistry
  writerRef?: { current: SubAgentStreamWriter | null }
  model: LanguageModel
  /** Model provider for creating sub-agent models (fast/smart) */
  provider?: (modelName: string) => LanguageModel
  /** 预加载的 Agent 定义（来自 AppContext 快照） */
  agents?: AgentDefinition[]
  /** 预加载的 MCP 配置（来自 AppContext 快照） */
  mcps?: McpServerConfig[]
  /** 模型别名映射（来自 BehaviorConfig.modelAliases） */
  modelAliases?: BehaviorConfig['modelAliases']
  /** 预加载的 skills（来自 AppContext 快照） */
  skills?: Skill[]
  /** WebSearch API Key（由应用层显式传入） */
  /** 是否开启调试日志 */
  debugEnabled?: boolean
  /** 共享 MCP 注册表（来自 AppContext，跨请求复用连接） */
  mcpRegistry?: import('../mcp').McpRegistry
  /** 是否允许动态重载（默认 false，仅显式 opt-in 时为 true） */
  dynamicReload?: boolean
  /** Cron 任务存储（来自 CoreRuntime，用于 cron 工具） */
  cronStore?: CronJobStore
  /** 用户级 tasks 目录（~/.agents/tasks），cron create 时同步写 task.md */
  tasksDir?: string
  /** 用户 ID（用于记忆系统） */
  userId?: string
  /** 知识库基础目录 */
  wikiBaseDir?: string
}

export interface WikiContext {
  recalledContent?: string
}
