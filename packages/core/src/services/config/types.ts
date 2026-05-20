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
export type { ModelCapabilities } from '../model/capabilities-types';

// 模型提供商配置
export type { ModelProviderConfig } from '../model/provider-types';

// 压缩配置
export type {
  CompactionConfig,
  LifecycleConfig,
  ContextWindowConfig,
} from '../../modules/compaction/types';

// 数据存储
export type { SQLiteDataStoreConfig } from '../../primitives/datastore/types';

// Skills
export type { SkillLoaderConfig } from '../../modules/skills/types';

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
} from '../../modules/connector/types';

// MCP
export type { McpServerConfig } from '../../modules/mcp/types';

// Permissions
export type { PermissionConfig, PermissionRule } from '../../modules/permissions/types';

// Session State（来自 types.ts）
export type { SessionStateOptions, SessionState } from '../../modules/session/types';

// Agent（来自 agent/types.ts）
export type {
  AgentContextConfig,
  LoadToolsConfig,
  CreateAgentConfig,
  CreateAgentResult,
  AgentModules,
  ResolvedAgentConfig,
} from '../../modules/agent/types';

