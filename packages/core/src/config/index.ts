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
  type LayoutConfig,
  type ResolvedLayout,
  type ResourceDirs,
} from './layout';

// ============================================================
// 基础设施常量（非行为配置）
// ============================================================
// 这些值不是调用方应调节的业务配置；保留仅供底层基础设施复用。
// ============================================================

export {
  DEFAULT_PROJECT_CONFIG_DIR_NAME,
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

// 从 runtime/budget 导出的类型
export type {
  ToolOutputConfig,
} from '../runtime/budget/tool-output-manager';
