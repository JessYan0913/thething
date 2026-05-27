// ============================================================
// Model Pricing Configuration - 模型定价配置
// ============================================================
//
// Core 模块不包含任何特定模型的硬编码定价。
// 所有定价信息必须通过 ModelSpec.pricing 或 bootstrap({ modelPricing }) 注入。
// ============================================================

import type { ModelSpec } from '../config/behavior';

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
  getModelPricing(model: string, modelSpec?: ModelSpec): ModelPricing;
  getPricingRegistry(): PricingRegistry;
}

/**
 * 默认定价（未知模型时使用）
 */
const FALLBACK_PRICING: ModelPricing = {
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
  modelSpec?: ModelSpec,
): ModelPricing {
  // 1. 优先使用 ModelSpec 中的定价配置
  if (modelSpec?.pricing) {
    return {
      input: modelSpec.pricing.input,
      output: modelSpec.pricing.output,
      cached: modelSpec.pricing.cached ?? 0,
    };
  }

  // 2. 精确匹配注册表
  if (registry[model]) {
    return registry[model];
  }

  // 3. 前缀模糊匹配
  const prefix = Object.keys(registry).find(k => model.startsWith(k));
  if (prefix) {
    return registry[prefix];
  }

  // 4. 未找到，返回默认定价
  return FALLBACK_PRICING;
}

/**
 * 创建定价解析器（实例级，不共享进程全局状态）
 */
export function createPricingResolver(
  overrides?: PricingRegistry,
  modelSpecs?: ModelSpec[],
): PricingResolver {
  // 从 ModelSpec 列表构建定价注册表
  const specsRegistry: PricingRegistry = {};
  if (modelSpecs) {
    for (const spec of modelSpecs) {
      if (spec.pricing) {
        specsRegistry[spec.id] = {
          input: spec.pricing.input,
          output: spec.pricing.output,
          cached: spec.pricing.cached ?? 0,
        };
      }
    }
  }

  const registry: PricingRegistry = {
    ...specsRegistry,
    ...(overrides ?? {}),
  };

  return {
    getModelPricing(model: string, modelSpec?: ModelSpec): ModelPricing {
      return resolvePricing(registry, model, modelSpec);
    },
    getPricingRegistry(): PricingRegistry {
      return { ...registry };
    },
  };
}
