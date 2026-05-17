// ============================================================
// Model Pricing Configuration - 模型定价配置
// ============================================================
//
// 定价数据通过 bootstrap({ modelPricing }) 注入，
// 内置定价表作为兜底默认值。
// ============================================================

/**
 * 模型定价配置
 * 单位：USD / 百万 token
 */
export interface ModelPricing {
  /** 每百万 input token 的费用 */
  input: number;
  /** 每百万 output token 的费用 */
  output: number;
  /** 每百万 cached token 的费用（缓存读取折扣） */
  cached: number;
}

/**
 * 定价注册表类型
 */
export type PricingRegistry = Record<string, ModelPricing>;

export interface PricingResolver {
  getModelPricing(model: string): ModelPricing;
  getPricingRegistry(): PricingRegistry;
}

/**
 * 内置定价表（作为兜底默认值）
 *
 * 数据来源：各厂商公开文档，不保证实时准确。
 * 生产部署时建议通过 bootstrap({ modelPricing }) 覆盖。
 */
export const DEFAULT_PRICING: PricingRegistry = {
  // Qwen 系列
  'qwen-max': { input: 4, output: 12, cached: 1 },
  'qwen-max-latest': { input: 4, output: 12, cached: 1 },
  'qwen-plus': { input: 1.5, output: 4.5, cached: 0.5 },
  'qwen-plus-latest': { input: 1.5, output: 4.5, cached: 0.5 },
  'qwen-turbo': { input: 0.5, output: 1.5, cached: 0.2 },
  'qwen-turbo-latest': { input: 0.5, output: 1.5, cached: 0.2 },
  // DeepSeek 系列
  'deepseek-v3': { input: 1.2, output: 4.8, cached: 0.4 },
};

/**
 * 默认定价（未知模型时使用）
 */
export const FALLBACK_PRICING: ModelPricing = {
  input: 1.5,
  output: 4.5,
  cached: 0.5,
};

// ============================================================
// 定价配置管理
// ============================================================

function resolvePricing(
  registry: PricingRegistry,
  model: string,
): ModelPricing {
  // 精确匹配
  if (registry[model]) {
    return registry[model];
  }

  // 前缀模糊匹配（处理 'qwen-max-2025-01-01' 这类带日期后缀的模型名）
  const prefix = Object.keys(registry).find(k => model.startsWith(k));
  if (prefix) {
    return registry[prefix];
  }

  // 未找到，返回默认定价
  return FALLBACK_PRICING;
}

/**
 * 创建定价解析器（实例级，不共享进程全局状态）
 */
export function createPricingResolver(overrides?: PricingRegistry): PricingResolver {
  const registry: PricingRegistry = {
    ...DEFAULT_PRICING,
    ...(overrides ?? {}),
  };

  return {
    getModelPricing(model: string): ModelPricing {
      return resolvePricing(registry, model);
    },
    getPricingRegistry(): PricingRegistry {
      return { ...registry };
    },
  };
}
