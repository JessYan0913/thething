// ============================================================
// @the-thing/core — Unified Export Entry
// ============================================================

// App (高层 API - 推荐)
export { createAgent, createContext } from './app';
export type {
  AppContext,
  CreateContextOptions,
  CreateAgentOptions,
  CreateAgentResult,
  LoadEvent,
  LoadSourceInfo,
  LoadError,
} from './app/types';

// Paths (路径计算)
export { detectProjectDir, getUserDataDir, getUserConfigDir, getProjectConfigDir } from './paths';

// Loaders (中层 API - 单模块加载)
export {
  loadSkills,
  loadAgents,
  loadMcpServers,
  loadConnectors,
  loadPermissions,
  loadMemory,
  loadAll,
  clearAllCache,
} from './loaders';

// Config (统一配置导出 - 所有配置常量和类型)
export * from './config';

// DataStore (data storage abstraction layer)
export * from './datastore';

// Native Module Loader (for SEA support)
export { loadBetterSqlite3, getDatabase } from './native-loader';

// Compaction
export * from './compaction';

// Connector Gateway
export * from './connector';

// MCP
export * from './mcp';

// Memory
export * from './memory';

// Permissions
export * from './permissions';

// Session State
export * from './session-state';

// Skills
export * from './skills';

// Parser (底层 API - 文件解析)
export {
  parseFrontmatterFile,
  parseYamlFile,
  parsePlainYamlFile,
  parseJsonFile,
  parseToolsList,
  ParseError,
  type ParseResult,
} from './parser';

// Scanner (底层 API - 目录扫描)
export {
  scanDir,
  scanDirs,
  scanConfigDirs,
  mergeByPriority,
  LoadingCache,
  type ScanOptions,
  type ScanConfig,
  type ScanResult,
  type CacheConfig,
} from './scanner';

// SubAgents
export * from './subagents';

// System Prompt
export * from './system-prompt';

// Tasks
export * from './tasks';

// Tools
export * from './tools';

// Tool Output Management (仅导出函数和类型，常量已在 config 中导出)
export {
  TOOL_RESULT_CLEARED_MESSAGE,
  PERSISTED_OUTPUT_TAG,
  PERSISTED_OUTPUT_CLOSING_TAG,
  getToolOutputConfig,
  matchesToolPrefix,
  getMessageBudgetLimit,
  createContentReplacementState,
  cloneContentReplacementState,
  estimateContentTokens,
  estimateObjectTokens,
  calculateOutputSize,
  processToolOutput,
  setToolOutputOverrides,
  getToolOutputOverrides,
  type ToolOutputConfig,
  type ContentReplacementState,
  type PersistedToolResult,
  type ContentReplacementRecord,
  type ToolOutputOverrides,
} from './utils/tool-output-manager';

// Tool Result Storage
export {
  getToolResultsDir,
  getToolResultPath,
  persistToolResult,
  generatePreview,
  buildPersistedOutputMessage,
  cleanupSessionToolResults,
  cleanupOldToolResults,
  formatSize,
} from './utils/tool-result-storage';

// Message Budget
export {
  enforceToolResultBudget,
  estimateToolResultsTotal,
  buildToolNameMap,
  type BudgetCheckResult,
} from './utils/message-budget';

// Middleware
export * from './middleware';

// Agent Control
export * from './agent-control';

// Model Provider
export * from './model-provider';

// Model Capabilities (仅导出函数，常量已在 config 中导出)
export {
  getModelContextLimit,
  getDefaultOutputTokens,
  getModelCapabilities,
  getEffectiveContextBudget,
  getAutoCompactThreshold,
  type ModelCapabilities,
} from './model-capabilities';

// Agent
export * from './agent';

// Init
export { initAll } from './init';