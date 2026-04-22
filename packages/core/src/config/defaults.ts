// ============================================================
// Defaults - 集中定义所有默认配置常量
// ============================================================
// 参考 Claude Code 的配置架构：默认值集中定义，便于维护和测试
//
// 重要：packages/core 中所有模块的配置常量都应从此文件导入
// 不允许在其他模块中重复定义相同的常量
//
// 设计原则：
// - Core 模块只定义业务逻辑默认值，不定义环境变量名
// - 环境变量名由应用层（CLI/Server）定义
// - Core 模块通过参数接收配置，不直接读取 process.env

// ============================================================
// 模型能力默认值
// ============================================================

/** 默认上下文限制（保守估计） */
export const DEFAULT_CONTEXT_LIMIT = 128_000;

/** 默认输出预留 */
export const DEFAULT_OUTPUT_TOKENS = 8_000;

/** 自动压缩缓冲区（参考 ClaudeCode: 13,000） */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

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

/** Session Memory Compact 默认配置 */
export const DEFAULT_SESSION_MEMORY_CONFIG = {
  minTokens: 10_000,
  maxTokens: 40_000,
  minTextBlockMessages: 5,
};

/** Micro Compact 默认配置（工具名数组形式，需在使用时转换为 Set） */
export const DEFAULT_MICRO_COMPACT_CONFIG_RAW = {
  timeWindowMs: 15 * 60 * 1000,  // 15 分钟
  imageMaxTokenSize: 2000,
  compactableTools: [
    // 核心工具（输出通常较大）
    'Read',
    'Bash',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
    'Edit',
    'Write',
  ],
  gapThresholdMinutes: 60,
  keepRecent: 5,
};

/** Post Compact 默认配置 */
export const DEFAULT_POST_COMPACT_CONFIG = {
  totalBudget: 50_000,
  maxFilesToRestore: 5,
  maxTokensPerFile: 5_000,
  maxTokensPerSkill: 5_000,
  skillsTokenBudget: 25_000,
};

// ============================================================
// 工具输出限制默认值
// ============================================================

/** 默认最大输出字符数 */
export const DEFAULT_MAX_OUTPUT_CHARS = 50_000;

/** 默认最大输出 Token 数 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 15_000;

// ============================================================
// Skills 配置默认值
// ============================================================

/** 默认 Skills 扫描目录 */
export const DEFAULT_SKILL_SCAN_DIRS = [
  '.thething/skills',
];

/** 默认 Skills 加载配置 */
export const DEFAULT_SKILL_LOADER_CONFIG = {
  scanDirs: DEFAULT_SKILL_SCAN_DIRS,
  maxSkills: 100,
  enableUsageTracking: true,
};

// ============================================================
// MCP 配置默认值
// ============================================================

/** 默认 MCP 配置目录 */
export const DEFAULT_MCP_CONFIG_DIR = '.thething/mcps';

// ============================================================
// Connector 配置默认值
// ============================================================

/** 默认 Connector 配置目录 */
export const DEFAULT_CONNECTORS_DIR = '.thething/connectors';

/** 电路断路器阈值 */
export const CIRCUIT_BREAKER_THRESHOLD = 3;

/** 电路断路器重置超时（5 分钟） */
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================
// Agent 配置默认值
// ============================================================

/** Agent 扫描目录 */
export const DEFAULT_AGENT_SCAN_DIRS = [
  '.thething/agents',
];

/** Agent 加载默认配置 */
export const DEFAULT_AGENT_LOADER_CONFIG = {
  sources: ['user', 'project'] as const,
  maxAgents: 50,
  enableCache: true,
};

/** 模型切换成本阈值（百分比） */
export const MODEL_SWITCH_COST_THRESHOLD = 80;

/** 可用模型列表默认配置 */
export const DEFAULT_AVAILABLE_MODELS = [
  { id: 'qwen-max', name: 'Qwen Max', costMultiplier: 1.0, capabilityTier: 3 },
  { id: 'qwen-plus', name: 'Qwen Plus', costMultiplier: 0.4, capabilityTier: 2 },
  { id: 'qwen-turbo', name: 'Qwen Turbo', costMultiplier: 0.1, capabilityTier: 1 },
];

// ============================================================
// 系统提示词默认值
// ============================================================

/** MEMORY.md 最大行数 */
export const MEMORY_MD_MAX_LINES = 200;

/** MEMORY.md 最大大小（KB） */
export const MEMORY_MD_MAX_SIZE_KB = 25;

// ============================================================
// 数据存储默认值
// ============================================================

/** 默认数据目录 */
export const DEFAULT_DATA_DIR = '.data';

/** 默认数据库文件名 */
export const DEFAULT_DB_FILENAME = 'chat.db';

// ============================================================
// 工具输出管理常量
// ============================================================

/** Bytes per Token 估算 */
export const BYTES_PER_TOKEN = 4;

/** 默认最大结果字符数 */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/** 最大工具结果 Token 数（约 400KB） */
export const MAX_TOOL_RESULT_TOKENS = 100_000;

/** 最大工具结果字节（从 Token 限制推导） */
export const MAX_TOOL_RESULT_BYTES = MAX_TOOL_RESULT_TOKENS * BYTES_PER_TOKEN;

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

// ============================================================
// 模型映射常量（用于子代理）
// ============================================================

/** 模型快捷映射 */
export const MODEL_MAPPING = {
  fast: 'qwen-turbo',
  smart: 'qwen-max',
  default: 'qwen-plus',
};