// ============================================================
// App Types - 应用层类型定义
// ============================================================

import type { UIMessage } from 'ai';
import type { Skill } from '../../extensions/skills/types';
import type { AgentDefinition } from '../../extensions/subagents/types';
import type { McpServerConfig } from '../../extensions/mcp/types';
import type { ConnectorFrontmatter } from '../../extensions/connector/loader';
import type { PermissionRule } from '../../extensions/permissions/types';
import type { MemoryEntry } from '../loaders/memory';

// ============================================================
// AppContext - 加载配置结果
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

export interface AppContext {
  cwd: string;
  dataDir: string;

  // 加载结果
  skills: Skill[];
  agents: AgentDefinition[];
  mcps: McpServerConfig[];
  connectors: ConnectorFrontmatter[];
  permissions: PermissionRule[];
  memory: MemoryEntry[];

  // 加载来源信息
  loadedFrom: LoadSourceInfo;

  // 加载错误
  errors?: LoadError[];
}

// ============================================================
// CreateContextOptions
// ============================================================

export interface CreateContextOptions {
  cwd?: string;
  dataDir?: string;
  verbose?: boolean;
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

export interface CreateAgentOptions {
  // 配置来源（三选一）
  cwd?: string;
  context?: AppContext;

  // 会话参数
  conversationId?: string;
  messages?: UIMessage[];
  userId?: string;

  // 模型配置
  model?: {
    apiKey?: string;
    baseURL?: string;
    modelName?: string;
    includeUsage?: boolean;
  };

  // Session 配置
  session?: {
    maxContextTokens?: number;
    maxBudgetUsd?: number;
    maxDenialsPerTool?: number;
    compactThreshold?: number;
  };

  // 压缩配置
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
      skillsTokenBudget?: number;
    };
  };

  // 模块控制
  modules?: {
    skills?: boolean;
    mcps?: boolean;
    memory?: boolean;
    connectors?: boolean;
    permissions?: boolean;
    compaction?: boolean;
  };

  // 高级参数
  writerRef?: { current: unknown };
}

// ============================================================
// CreateAgentResult
// ============================================================

export interface CreateAgentResult {
  agent: unknown;  // ToolLoopAgent from ai
  sessionState: unknown;  // SessionState
  mcpRegistry?: unknown;  // McpRegistry
  tools: Record<string, unknown>;  // ToolSet
  instructions: string;
  adjustedMessages?: UIMessage[];
  budgetActions?: string[];
  model: unknown;  // LanguageModelV3
}