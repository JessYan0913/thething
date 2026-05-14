// ============================================================
// Budget Module - 预算管理
// ============================================================
// 提供工具输出管理和消息预算功能：
// - tool-output-manager: 单工具阈值截断
// - tool-result-storage: 工具结果持久化存储
// - message-budget: 消息级预算检查
// ============================================================

export {
  TOOL_RESULT_CLEARED_MESSAGE,
  PERSISTED_OUTPUT_TAG,
  PERSISTED_OUTPUT_CLOSING_TAG,
  getToolOutputConfig,
  matchesToolPrefix,
  getMessageBudgetLimit,
  getPreviewSizeLimit,
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
} from './tool-output-manager';

export {
  getToolResultsDir,
  getToolResultPath,
  persistToolResult,
  generatePreview,
  buildPersistedOutputMessage,
  cleanupSessionToolResults,
  cleanupOldToolResults,
  formatSize,
} from './tool-result-storage';

export {
  enforceToolResultBudget,
  estimateToolResultsTotal,
  buildToolNameMap,
  type BudgetCheckResult,
} from './message-budget';
