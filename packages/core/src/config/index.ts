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
// 5. 项目目录检测由 paths/ 模块提供（resolveProjectDir）
//
// 重要变更（2026-04）：
// - 业务行为常量已迁移到 BehaviorConfig
// - 布局常量已迁移到 ResolvedLayout
// - defaults.ts 仅作为 buildBehaviorConfig/resolveLayout 的默认值来源
// - 调用方应通过 runtime.behavior 或 runtime.layout 获取配置
// ============================================================

// ============================================================
// 新的配置系统（推荐使用）
// ============================================================

// BehaviorConfig - 运行时行为配置
export {
  buildBehaviorConfig,
  DEFAULT_MODEL_SPECS,
  DEFAULT_MODEL_ALIASES,
  type BehaviorConfig,
  type ModelSpec,
  // 新增：子配置类型导出（behavior.ts 中定义）
  type CompactionConfig,
  type ToolOutputLimitsConfig,
  type MemoryLimitsConfig,
} from './behavior';

// LayoutConfig - 文件系统布局配置
export {
  resolveLayout,
  buildDefaultResourceLayout,
  type LayoutConfig,
  type ResolvedLayout,
  type ResourceDirs,
  type ResourceLayout,  // deprecated alias
} from './layout';

// ============================================================
// 默认值常量（统一导出）
// ============================================================
// 注意：以下常量已迁移到 BehaviorConfig 或 ResolvedLayout
// 此处保留导出仅为向后兼容，建议从配置系统获取
// ============================================================

// 模型能力（已迁移到 BehaviorConfig）
/** @deprecated 使用 BehaviorConfig.maxContextTokens 代替 */
export {
  DEFAULT_CONTEXT_LIMIT,
} from './defaults';
/** @deprecated 使用 foundation/model/capabilities 接收配置参数代替 */
export {
  DEFAULT_OUTPUT_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
} from './defaults';

// Session（已迁移到 BehaviorConfig）
/** @deprecated 使用 BehaviorConfig.maxBudgetUsdPerSession 代替 */
export { DEFAULT_MAX_BUDGET_USD } from './defaults';
/** @deprecated 使用 BehaviorConfig.maxDenialsPerTool 代替 */
export { DEFAULT_MAX_DENIALS_PER_TOOL } from './defaults';

// 压缩配置（已迁移到 BehaviorConfig.compaction）
/** @deprecated 使用 BehaviorConfig.compactionThreshold 代替 */
export {
  COMPACT_TOKEN_THRESHOLD,
} from './defaults';
/** @deprecated 使用 BehaviorConfig.compaction.sessionMemory 代替 */
export {
  DEFAULT_SESSION_MEMORY_CONFIG,
  DEFAULT_POST_COMPACT_CONFIG,
} from './defaults';

// Micro Compact 配置（Set 形式，从 compaction/types 导出）
/** @deprecated 使用 BehaviorConfig.compaction.micro 代替 */
export { DEFAULT_MICRO_COMPACT_CONFIG } from '../runtime/compaction/types';

// 原始配置（数组形式，用于自定义转换）
/** @deprecated 使用 BehaviorConfig.compaction.micro 代替 */
export { DEFAULT_MICRO_COMPACT_CONFIG_RAW } from './defaults';

// 工具输出（已迁移到 BehaviorConfig.toolOutput）
/** @deprecated 未使用 */
export {
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from './defaults';
/** @deprecated 使用 BehaviorConfig.toolOutput.maxResultSizeChars 代替 */
export {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
} from './defaults';
/** @deprecated 纯计算常量，可保留使用 */
export {
  BYTES_PER_TOKEN,
} from './defaults';

// Skills（已迁移到 ResolvedLayout.resources）
/** @deprecated 使用 resolveLayout().resources.skills 代替 */
export { DEFAULT_SKILL_SCAN_DIRS } from './defaults';
/** @deprecated 未使用 */
export { DEFAULT_SKILL_LOADER_CONFIG } from './defaults';

// MCP（已迁移到 ResolvedLayout.resources）
/** @deprecated 使用 resolveLayout().resources.mcps 代替 */
export { DEFAULT_MCP_CONFIG_DIR } from './defaults';

// Permissions（已迁移到 ResolvedLayout.filenames）
/** @deprecated 使用 resolveLayout().filenames.permissions 代替 */
export {
  PERMISSIONS_FILENAME,
} from './defaults';
/** @deprecated 使用 resolveLayout().resources.permissions 代替 */
export { DEFAULT_PERMISSIONS_DIR } from './defaults';

// Connector（已迁移到 ResolvedLayout.resources）
/** @deprecated 纯技术常量，可保留使用 */
export {
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
} from './defaults';
/** @deprecated 使用 resolveLayout().resources.connectors 代替 */
export { DEFAULT_CONNECTORS_DIR } from './defaults';

// Agent Control（已迁移到 BehaviorConfig）
/** @deprecated 使用 BehaviorConfig.autoDowngradeCostThreshold 代替 */
export { MODEL_SWITCH_COST_THRESHOLD } from './defaults';
/** @deprecated 使用 DEFAULT_MODEL_SPECS 或 BehaviorConfig.availableModels 代替 */
export { DEFAULT_AVAILABLE_MODELS } from './defaults';
/** @deprecated 使用 BehaviorConfig.modelAliases 代替 */
export { MODEL_MAPPING } from './defaults';

// 系统提示词（已迁移到 BehaviorConfig.memory）
/** @deprecated 使用 BehaviorConfig.memory.mdMaxLines 代替 */
export {
  MEMORY_MD_MAX_LINES,
  MEMORY_MD_MAX_SIZE_KB,
} from './defaults';

// Memory 系统（已迁移到 BehaviorConfig.memory）
/** @deprecated 使用 BehaviorConfig.memory.entrypointMaxLines 代替 */
export {
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
} from './defaults';

// 数据存储（已迁移到 ResolvedLayout）
/** @deprecated 使用 resolveLayout().dataDir 代替 */
export {
  DEFAULT_DATA_DIR,
} from './defaults';
/** @deprecated 使用 resolveLayout().filenames.db 代替 */
export {
  DEFAULT_DB_FILENAME,
} from './defaults';

// 项目配置目录（保留 - foundation 层全局单例 fallback）
export {
  DEFAULT_PROJECT_CONFIG_DIR_NAME,
} from './defaults';

// Tokenizer 远程加载（保留 - 基础设施常量）
export {
  TOKENIZER_CACHE_DIR_NAME,
  HF_MIRROR_BASE_URL,
  HF_OFFICIAL_BASE_URL,
  MODEL_TO_HF_REPO_MAPPING,
  DEFAULT_TOKENIZER_REPO,
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
} from '../foundation/model';

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
  ConnectorRuntimeConfig,
  AuthConfig,
  ToolDefinition,
  SchemaProperty,
  HttpExecutorConfig,
  SqlExecutorConfig,
  ScriptExecutorConfig,
  MockExecutorConfig,
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
  AgentToolDefinitionConfig,
  TaskSchedulerConfig,
  TaskSyncConfig,
} from './types';

// 从 runtime/budget 导出的类型
export type {
  ToolOutputConfig,
  ToolOutputOverrides,
} from '../runtime/budget/tool-output-manager';
