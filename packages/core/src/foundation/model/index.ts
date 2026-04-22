// ============================================================
// Foundation Model - 模型提供者和能力配置
// ============================================================
// 合并原 model-provider 和 model-capabilities 模块
// ============================================================

// Provider
export { createModelProvider, createLanguageModel } from './provider';
export type { ModelProviderConfig, ModelProviderFn } from './provider-types';

// Capabilities
export {
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
  getModelContextLimit,
  getDefaultOutputTokens,
  getModelCapabilities,
  getEffectiveContextBudget,
  getAutoCompactThreshold,
} from './capabilities';
export type { ModelCapabilities } from './capabilities-types';