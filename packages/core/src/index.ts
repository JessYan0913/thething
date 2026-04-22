// ============================================================
// @the-thing/core — Unified Export Entry
// ============================================================

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

// Loading (共享加载基础设施)
export * from './loading';

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