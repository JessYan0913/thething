// ============================================================
// Model Capabilities - 模型上下文限制配置
// ============================================================
// Core 模块只提供计算函数，不包含任何特定模型的硬编码配置。
// 所有模型能力参数必须通过 ModelSpec 或 limitOverride 注入。
// ============================================================

import {
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_TOKENS,
} from './constants';

import type { ModelCapabilities } from './capabilities-types';
import type { ModelSpec } from '../config/behavior';

export type { ModelCapabilities };

// ============================================================
// 核心函数
// ============================================================

/**
 * 获取模型上下文限制
 *
 * 优先级：
 * 1. 显式传入的 limitOverride 参数（最高优先级）
 * 2. ModelSpec 中的 contextLimit 配置
 * 3. 模型名后缀 [1m]、[512k]、[256k]
 * 4. 兜底默认值 128K
 *
 * @throws 如果没有提供任何配置且 modelName 无法解析后缀，将使用默认值
 */
export function getModelContextLimit(
  modelName: string,
  limitOverride?: number,
  modelSpec?: ModelSpec
): number {
  // 1. 显式传入的覆盖值（最高优先级）
  if (limitOverride && limitOverride > 0) {
    return limitOverride;
  }

  // 2. ModelSpec 中的配置
  if (modelSpec?.contextLimit && modelSpec.contextLimit > 0) {
    return modelSpec.contextLimit;
  }

  if (!modelName) {
    return DEFAULT_CONTEXT_LIMIT;
  }

  // 3. 模型名后缀解析（允许用户在模型名中标注上下文大小）
  if (modelName.includes('[1m]')) {
    return 1_000_000;
  }
  if (modelName.includes('[512k]')) {
    return 512_000;
  }
  if (modelName.includes('[256k]')) {
    return 256_000;
  }

  // 4. 兜底默认值（应通过 ModelSpec 配置避免使用此默认值）
  return DEFAULT_CONTEXT_LIMIT;
}

/**
 * 获取输出预留 Token 数（纯预算估算值，不是 provider 上限）。
 * 学 pi：输出上限交给 provider 默认（模型未声明则不发送 maxOutputTokens）；
 * 此处只给预算闸门一个"预留输出空间"的规划数，避免输入填满窗口、模型无地写答案。
 */
export function getDefaultOutputTokens(): number {
  return DEFAULT_OUTPUT_TOKENS;
}

/**
 * 获取模型能力配置
 */
export function getModelCapabilities(
  modelName: string,
  options?: { contextLimitOverride?: number; modelSpec?: ModelSpec }
): ModelCapabilities {
  return {
    contextLimit: getModelContextLimit(modelName, options?.contextLimitOverride, options?.modelSpec),
    defaultOutputTokens: getDefaultOutputTokens(),
  };
}

/**
 * 计算有效上下文预算
 * 有效上下文 = 窗口 - 输出预留
 */
export function getEffectiveContextBudget(
  modelName: string,
  options?: { contextLimitOverride?: number; modelSpec?: ModelSpec }
): number {
  const contextLimit = getModelContextLimit(modelName, options?.contextLimitOverride, options?.modelSpec);
  const outputReserve = Math.min(getDefaultOutputTokens(), 20_000);
  return contextLimit - outputReserve;
}
