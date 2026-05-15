// ============================================================
// App Types - 应用层类型定义
// ============================================================

import type { UIMessage, Tool, ToolLoopAgent } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { Skill } from '../../extensions/skills/types';
import type { AgentDefinition } from '../../extensions/subagents/types';
import type { McpServerConfig } from '../../extensions/mcp/types';
import type { ConnectorFrontmatter } from '../../extensions/connector/loader';
import type { PermissionRule } from '../../extensions/permissions/types';
import type { MemoryEntry } from '../loaders/memory';
import type { CoreRuntime } from '../../bootstrap';
import type { ResolvedLayout } from '../../config/layout';
import type { BehaviorConfig } from '../../config/behavior';
import type { SessionState } from '../../runtime/session-state';
import type { McpRegistry } from '../../extensions/mcp';

// ============================================================
// AppContext - 加载配置结果（不可变快照）
// ============================================================

export interface LoadSourceInfo {
  skills: { path: string; source: 'user' | 'project'; count: number };
  agents: { path: string; source: 'user' | 'project'; count: number };
  mcps: { path: string; source: 'user' | 'project'; count: number };
  connectors: { path: string; source: 'user' | 'project'; count: number };
  permissions: {
    userPath: string; userCount: number;
    projectPath: string; projectCount: number;
  };
  memory: { path: string; count: number };
}

export interface LoadError {
  module: string;
  path: string;
  error: string;
}

/**
 * AppContext - 配置快照
 *
 * 代表"已加载的配置"，是不可变快照。
 * 一轮对话绑定一个 AppContext，如果需要更新，下一轮对话用新的 AppContext。
 * reload() 方法返回新实例，旧实例不变。
 */
export interface AppContext {
  /** 绑定此 context 的运行时，提供数据存储等基础设施 */
  readonly runtime: CoreRuntime;
  /** 展开后的布局（所有路径已解析为绝对路径） */
  readonly layout: ResolvedLayout;
  /** 行为配置（所有字段已填充默认值） */
  readonly behavior: BehaviorConfig;
  // 加载结果（只读快照）
  readonly skills: readonly Skill[];
  readonly agents: readonly AgentDefinition[];
  readonly mcps: readonly McpServerConfig[];
  readonly connectors: readonly ConnectorFrontmatter[];
  readonly permissions: readonly PermissionRule[];
  readonly memory: readonly MemoryEntry[];

  // 加载来源信息（用于调试/日志）
  readonly loadedFrom: LoadSourceInfo;

  // 加载错误
  readonly errors?: LoadError[];

  /**
   * 重新加载所有资源，返回新的 AppContext 快照。
   * 原 context 实例保持不变（不可变设计）。
   */
  reload(options?: { verbose?: boolean; onLoad?: (event: LoadEvent) => void }): Promise<AppContext>;
}

// ============================================================
// CreateContextOptions
// ============================================================

export interface CreateContextOptions {
  /** 运行时实例（必填） */
  runtime: CoreRuntime;
  /** 详细日志 */
  verbose?: boolean;
  /** 加载事件回调 */
  onLoad?: (event: LoadEvent) => void;
}

export interface LoadEvent {
  module: 'skills' | 'agents' | 'mcps' | 'connectors' | 'permissions' | 'memory';
  path: string;
  source?: 'user' | 'project';
  count: number;
  duration?: number;
}

// ============================================================
// CreateAgentOptions
// ============================================================

/**
 * 模型配置（必填）
 *
 * core 包是库，不是应用。库不应该假设环境变量的存在。
 * API Key、Base URL 等变量由应用层（CLI/Server）管理，通过参数显式传入。
 */
export interface ModelConfig {
  apiKey: string;
  baseURL: string;
  modelName: string;
  includeUsage?: boolean;
  enableThinking?: boolean;
}

export interface CreateAgentOptions {
  /**
   * 必须提供 context（已加载配置快照）。
   */
  context: AppContext;

  /** 会话 ID */
  conversationId: string;
  /** 消息列表 */
  messages?: UIMessage[];
  /** 用户 ID */
  userId?: string;

  /** 模型配置（必填） */
  model: ModelConfig;

  /** Session 配置 */
  session?: {
    maxContextTokens?: number;
    maxBudgetUsd?: number;
    maxDenialsPerTool?: number;
    compactThreshold?: number;
  };

  /** 压缩配置 */
  compaction?: {
    threshold?: number;
    bufferTokens?: number;
    sessionMemory?: {
      minTokens?: number;
      maxTokens?: number;
      minTextBlockMessages?: number;
    };
    micro?: {
      timeWindowMs?: number;
      imageMaxTokenSize?: number;
      compactableTools?: string[];
      gapThresholdMinutes?: number;
      keepRecent?: number;
    };
    postCompact?: {
      totalBudget?: number;
      maxFilesToRestore?: number;
      maxTokensPerFile?: number;
      maxTokensPerSkill?: number;
      skillsTokenBudget?: number;
    };
  };

  /** 模块控制 */
  modules?: {
    skills?: boolean;
    mcps?: boolean;
    memory?: boolean;
    connectors?: boolean;
    permissions?: boolean;
    compaction?: boolean;
  };

  /** 高级参数 */
  writerRef?: { current: unknown };

  /**
   * 动态重载控制（默认 false）。
   *
   * 设为 true 时，agent tool 在运行中可重新扫描目录加载新的子 agent 配置，
   * 绕过 AppContext 快照。
   * 仅用于需要热更新的特殊场景；正常流程应使用 AppContext.reload() 创建新快照。
   */
  dynamicReload?: boolean;

  /** 对话元数据（用于控制技能附件注入等行为） */
  conversationMeta?: {
    /** 是否是新对话（首次消息） */
    isNewConversation: boolean;
    /** 对话开始时间戳 */
    conversationStartTime?: number;
  };
}

// ============================================================
// CreateAgentResult
// ============================================================

/**
 * Agent 创建结果
 *
 * 包含发起对话所需的全部类型化引用。
 * 通过 createAgent() 获得，生命周期绑定到一次对话。
 */
export interface CreateAgentResult {
  /** Vercel AI SDK ToolLoopAgent 实例，可直接调用 streamText/generateText */
  agent: ToolLoopAgent;
  /** 当前会话状态（预算、活跃技能、否决计数等） */
  sessionState: SessionState;
  /** 已注册的 MCP 注册表，对话结束后调用 disconnectAll() */
  mcpRegistry?: McpRegistry | null;
  /** 当前对话可用的工具集（已应用权限过滤） */
  tools: Record<string, Tool>;
  /** 注入到 system prompt 的完整指令字符串 */
  instructions: string;
  /**
   * 经过预算检查和附件注入后的消息列表。
   * 调用 agent.stream() 时传入此列表，而非原始 messages。
   */
  adjustedMessages?: UIMessage[];
  /** 预算检查执行的降级动作列表 */
  budgetActions?: string[];
  /** 底层模型实例（未包装 middleware），供后台任务使用 */
  model?: LanguageModelV3;

  /**
   * 释放本次对话占用的所有资源。
   *
   * 执行顺序：
   * 1. 持久化成本数据到数据库
   * 2. 等待进行中的后台压缩完成（可选）
   * 3. 断开所有 MCP 连接
   *
   * 在 createAgent 的 onFinish 回调中调用：
   * ```typescript
   * onFinish: async () => {
   *   await handle.dispose();
   * }
   * ```
   *
   * @param options.waitForCompaction - 是否等待后台压缩完成（默认 false）
   */
  dispose(options?: { waitForCompaction?: boolean }): Promise<void>;
}
