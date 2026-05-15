// ============================================================
// Config Types - 跨模块共享的配置接口
// ============================================================
// 设计原则：
// 1. 只定义跨模块组合的配置类型
// 2. 模块专用类型在各模块中定义，此处重新导出
// 3. 避免重复定义，避免字段不一致

// ============================================================
// 重新导出各模块类型（避免重复定义）
// ============================================================

// 模型能力
export type { ModelCapabilities } from '../foundation/model/capabilities-types';

// 模型提供商配置
export type { ModelProviderConfig } from '../foundation/model/provider-types';

// 压缩配置
export type {
  SessionMemoryCompactConfig,
  MicroCompactConfig,
  PostCompactConfig,
} from '../runtime/compaction/types';

// 数据存储
export type { SQLiteDataStoreConfig } from '../foundation/datastore/types';

// Skills
export type { SkillLoaderConfig } from '../extensions/skills/types';

// Connector（从 connector/types.ts 重新导出，不包括 init.ts 的 ConnectorGatewayConfig）
export type {
  ConnectorDefinition,
  ConnectorRuntimeConfig,
  AuthConfig,
  ToolDefinition,
  SchemaProperty,
  HttpExecutorConfig,
  SqlExecutorConfig,
  ScriptExecutorConfig,
  MockExecutorConfig,
} from '../extensions/connector/types';

// MCP
export type { McpServerConfig } from '../extensions/mcp/types';

// Permissions
export type { PermissionConfig, PermissionRule } from '../extensions/permissions/types';

// Session State（来自 types.ts）
export type { SessionStateOptions, SessionState } from '../runtime/session-state/types';

// Agent Control（来自 agent-control）
export type {
  AgentPipelineConfig,
  DenialTrackerConfig,
  ModelProvider as ModelProviderInfo,
  ModelSwitchConfig,
} from '../runtime/agent-control';

// Agent（来自 agent/types.ts）
export type {
  AgentContextConfig,
  LoadToolsConfig,
  CreateAgentConfig,
  CreateAgentResult,
  AgentModules,
  ResolvedAgentConfig,
} from '../runtime/agent/types';

// ============================================================
// 仅在 config 中定义的类型（未被其他模块定义）
// ============================================================

/**
 * Agent 工具定义配置（用于定义 Agent 可用工具）
 * 注意：与 subagents/types.ts 的 AgentToolConfig 不同（那是执行上下文）
 */
export interface AgentToolDefinitionConfig {
  /** Agent 类型 */
  agentType: string;
  /** 描述 */
  description: string;
  /** 允许的工具 */
  allowedTools?: string[];
  /** 模型覆盖 */
  modelOverride?: string;
}

/**
 * 任务调度器配置
 */
export interface TaskSchedulerConfig {
  /** 最大并发任务 */
  maxConcurrentTasks?: number;
  /** 任务超时（毫秒） */
  taskTimeoutMs?: number;
}

/**
 * 任务同步配置
 */
export interface TaskSyncConfig {
  /** 同步间隔（毫秒） */
  syncIntervalMs?: number;
}
