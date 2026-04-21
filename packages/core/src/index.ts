// ============================================================
// @the-thing/core — Unified Export Entry
// ============================================================

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

// SubAgents
export * from './subagents';

// System Prompt
export * from './system-prompt';

// Tasks
export * from './tasks';

// Tools
export * from './tools';

// Tool Output Management
export {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
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

// Model Capabilities
export {
  ENV_CONTEXT_LIMIT,
  ENV_OUTPUT_TOKENS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
  getModelContextLimit,
  getDefaultOutputTokens,
  getModelCapabilities,
  getEffectiveContextBudget,
  getAutoCompactThreshold,
  setModelContextLimit,
  type ModelCapabilities,
} from './model-capabilities';

// Agent
export * from './agent';

// Init
export { initAll } from './init';
export type { InitConfig } from './init';