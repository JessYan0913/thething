// ============================================================
// Defaults - 业务配置默认值
// ============================================================
//
// 本文件仅包含业务配置默认值，供 buildBehaviorConfig() 和 resolveLayout() 使用。
//
// 纯技术常量已迁移到：
//   - foundation/constants.ts     （BYTES_PER_TOKEN、DEFAULT_PROJECT_CONFIG_DIR_NAME 等）
//   - foundation/model/constants.ts （DEFAULT_CONTEXT_LIMIT、DEFAULT_OUTPUT_TOKENS）
//   - foundation/datastore/constants.ts（DEFAULT_DATA_DIR、DEFAULT_DB_FILENAME）
//
// 设计原则：
// - 本文件只定义业务配置默认值（预算、压缩策略、限制等）
// - 环境变量名由应用层（CLI/Server）定义
// ============================================================

// ============================================================
// Session 状态默认值
// ============================================================

/** 默认最大预算（美元） */
export const DEFAULT_MAX_BUDGET_USD = 5.0;

/** 默认最大拒绝次数（每工具） */
export const DEFAULT_MAX_DENIALS_PER_TOOL = 3;

// ============================================================
// 压缩配置默认值
// ============================================================

/** 压缩触发阈值 */
export const COMPACT_TOKEN_THRESHOLD = 25_000;

// ============================================================
// Skills 配置默认值
// ============================================================

/** 默认 Skills 加载配置 */
export const DEFAULT_SKILL_LOADER_CONFIG = {
  cwd: undefined,
  scanDirs: ['.thething/skills'],
  maxSkills: 100,
  enableUsageTracking: true,
};

/** Permissions 配置文件名 */
export const PERMISSIONS_FILENAME = 'permissions.json';

// ============================================================
// Connector 配置默认值
// ============================================================

/** 电路断路器阈值 */
export const CIRCUIT_BREAKER_THRESHOLD = 3;

/** 电路断路器重置超时（5 分钟） */
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================
// Agent 配置默认值
// ============================================================

/** MEMORY.md 最大行数 */
export const MEMORY_MD_MAX_LINES = 200;

/** MEMORY.md 最大大小（KB） */
export const MEMORY_MD_MAX_SIZE_KB = 25;

// ============================================================
// 工具输出管理常量
// ============================================================

/** 默认最大结果字符数 */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/** 最大工具结果 Token 数（约 400KB） */
export const MAX_TOOL_RESULT_TOKENS = 100_000;

/** 单轮消息中所有工具结果总额上限 */
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000;

/** 预览内容大小（字符） */
export const PREVIEW_SIZE_CHARS = 2_000;

// ============================================================
// Memory 系统常量
// ============================================================

/** Memory 入口文件最大行数 */
export const MAX_ENTRYPOINT_LINES = 200;

/** Memory 入口文件最大字节（25KB） */
export const MAX_ENTRYPOINT_BYTES = 25_000;
