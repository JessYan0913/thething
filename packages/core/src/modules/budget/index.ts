// ============================================================
// Budget Module - 预算管理
// ============================================================
// 提供工具输出管理和持久化存储功能：
// - tool-output-manager: 单工具阈值截断
// - tool-result-storage: 工具结果持久化存储
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
  type ToolOutputConfig,
  type ContentReplacementState,
  type PersistedToolResult,
  type ContentReplacementRecord,
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
