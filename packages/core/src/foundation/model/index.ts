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
  getModelContextLimit,
  getDefaultOutputTokens,
  getModelCapabilities,
  getEffectiveContextBudget,
  getAutoCompactThreshold,
} from './capabilities';
export type { ModelCapabilities } from './capabilities-types';

// Pricing（定价配置）
export {
  DEFAULT_PRICING,
  FALLBACK_PRICING,
  configurePricing,
  getModelPricing,
  getPricingRegistry,
  resetPricing,
} from './pricing';
export type { ModelPricing, PricingRegistry } from './pricing';
