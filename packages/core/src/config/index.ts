// ============================================================
// Config - 统一配置导出入口
// ============================================================
// 参考 Claude Code 的配置架构：集中导出，便于使用
//
// 设计原则：
// 1. 默认值常量统一在 defaults.ts 定义和导出
// 2. 类型定义在各模块中维护，config/types.ts 仅重新导出
// 3. 所有 core 包模块的配置常量都从这里导入
// 4. 环境变量名由应用层（CLI/Server）定义，core 不导出
// 5. 项目目录检测由 paths/ 模块提供（detectProjectDir）

// ============================================================
// 默认值常量（统一导出）
// ============================================================

// 模型能力
export {
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
} from './defaults';

// Session
export {
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MAX_DENIALS_PER_TOOL,
} from './defaults';

// 压缩配置
export {
  COMPACT_TOKEN_THRESHOLD,
  DEFAULT_SESSION_MEMORY_CONFIG,
  DEFAULT_POST_COMPACT_CONFIG,
} from './defaults';

// Micro Compact 配置（Set 形式，从 compaction/types 导出）
export { DEFAULT_MICRO_COMPACT_CONFIG } from '../compaction/types';

// 原始配置（数组形式，用于自定义转换）
export { DEFAULT_MICRO_COMPACT_CONFIG_RAW } from './defaults';

// 工具输出
export {
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
  BYTES_PER_TOKEN,
} from './defaults';

// Skills
export {
  DEFAULT_SKILL_SCAN_DIRS,
  DEFAULT_SKILL_LOADER_CONFIG,
} from './defaults';

// MCP
export {
  DEFAULT_MCP_CONFIG_DIR,
} from './defaults';

// Permissions
export {
  DEFAULT_PERMISSIONS_DIR,
  PERMISSIONS_FILENAME,
} from './defaults';

// Connector
export {
  DEFAULT_CONNECTORS_DIR,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
} from './defaults';

// Agent Control
export {
  MODEL_SWITCH_COST_THRESHOLD,
  DEFAULT_AVAILABLE_MODELS,
  MODEL_MAPPING,
} from './defaults';

// 系统提示词
export {
  MEMORY_MD_MAX_LINES,
  MEMORY_MD_MAX_SIZE_KB,
} from './defaults';

// Memory 系统
export {
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
} from './defaults';

// 数据存储
export {
  DEFAULT_DATA_DIR,
  DEFAULT_DB_FILENAME,
} from './defaults';

// ============================================================
// 从原有模块导出的函数（保持兼容）
// ============================================================
export {
  getModelContextLimit,
  getDefaultOutputTokens,
  getModelCapabilities,
  getEffectiveContextBudget,
  getAutoCompactThreshold,
} from '../model-capabilities';

// ============================================================
// 类型导出（统一从 config/types.ts 导出）
// ============================================================

// 重新导出的模块类型
export type {
  ModelCapabilities,
  ModelProviderConfig,
  SessionMemoryCompactConfig,
  MicroCompactConfig,
  PostCompactConfig,
  SQLiteDataStoreConfig,
  SkillLoaderConfig,
  ConnectorDefinition,
  AuthConfig,
  ToolDefinition,
  SchemaProperty,
  HttpExecutorConfig,
  SqlExecutorConfig,
  ScriptExecutorConfig,
  MockExecutorConfig,
  ConnectorGatewayConfig,
  WebhookConfigLoaded,
  WechatWebhookConfig,
  FeishuWebhookConfig,
  McpServerConfig,
  PermissionConfig,
  PermissionRule,
  SessionStateOptions,
  SessionState,
  AgentPipelineConfig,
  DenialTrackerConfig,
  ModelProviderInfo,
  ModelSwitchConfig,
} from './types';

// 跨模块组合类型（仅在 config/types.ts 定义）
export type {
  InitConfig,
  ToolOutputConfig,
  ToolOutputOverrides,
  AgentToolDefinitionConfig,
  TaskSchedulerConfig,
  TaskSyncConfig,
} from './types';