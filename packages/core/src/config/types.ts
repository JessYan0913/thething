// ============================================================
// Config Types - 跨模块共享的配置接口
// ============================================================
// 设计原则：
// 1. 只定义跨模块组合的配置类型（如 InitConfig、ToolOutputConfig）
// 2. 模块专用类型在各模块中定义，此处重新导出
// 3. 避免重复定义，避免字段不一致

// ============================================================
// 重新导出各模块类型（避免重复定义）
// ============================================================

// 模型能力
export type { ModelCapabilities } from '../model-capabilities/types';

// 模型提供商配置
export type { ModelProviderConfig } from '../model-provider/types';

// 压缩配置
export type {
  SessionMemoryCompactConfig,
  MicroCompactConfig,
  PostCompactConfig,
} from '../compaction/types';

// 数据存储
export type { SQLiteDataStoreConfig } from '../datastore/types';

// Skills
export type { SkillLoaderConfig } from '../skills/types';

// Connector（从 connector/types.ts 重新导出，不包括 init.ts 的 ConnectorGatewayConfig）
export type {
  ConnectorDefinition,
  AuthConfig,
  ToolDefinition,
  SchemaProperty,
  HttpExecutorConfig,
  SqlExecutorConfig,
  ScriptExecutorConfig,
  MockExecutorConfig,
} from '../connector/types';

// Connector Gateway 配置（来自 init.ts）
export type { ConnectorGatewayConfig } from '../connector/init';

// Webhook 配置（来自 webhook-config.ts）
export type {
  WebhookConfigLoaded,
  WechatWebhookConfig,
  FeishuWebhookConfig,
} from '../connector/webhook-config';

// MCP
export type { McpServerConfig } from '../mcp/types';

// Permissions
export type { PermissionConfig, PermissionRule } from '../permissions/types';

// Session State（来自 types.ts）
export type { SessionStateOptions, SessionState } from '../session-state/types';

// Agent Control（来自 agent-control）
export type {
  AgentPipelineConfig,
  DenialTrackerConfig,
  ModelProvider as ModelProviderInfo,
  ModelSwitchConfig,
} from '../agent-control';

// Agent（来自 agent/types.ts）
export type {
  AgentContextConfig,
  LoadToolsConfig,
  CreateAgentConfig,
  CreateAgentResult,
} from '../agent/types';

// Memory（来自 memory/paths.ts）
export type { MemoryConfig } from '../memory/paths';

// ============================================================
// 仅在 config 中定义的类型（未被其他模块定义）
// ============================================================

/**
 * 全局初始化配置
 * 组合多个模块的配置，用于 initAll() 函数
 */
export interface InitConfig {
  /** 数据目录 */
  dataDir: string;
  /** 项目目录（可选，默认自动检测） */
  cwd?: string;
  /** 数据库配置 */
  databaseConfig?: import('../datastore/types').SQLiteDataStoreConfig;
  /** Connector 配置 */
  connectorConfig?: import('../connector/init').ConnectorGatewayConfig;
}

/**
 * 工具输出配置
 */
export interface ToolOutputConfig {
  /** 最大结果字符数 */
  maxResultSizeChars: number;
  /** 最大 Token 数 */
  maxTokens: number;
  /** 截断消息 */
  truncationMessage: string;
}

/**
 * 工具输出覆盖配置
 */
export interface ToolOutputOverrides {
  /** 按工具名覆盖 */
  byToolName?: Record<string, Partial<ToolOutputConfig>>;
  /** 按工具前缀覆盖 */
  byPrefix?: Record<string, Partial<ToolOutputConfig>>;
  /** 全局覆盖 */
  global?: Partial<ToolOutputConfig>;
}

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