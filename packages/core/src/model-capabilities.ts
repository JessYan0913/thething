// ============================================================
// Model Capabilities - 模型上下文限制配置
// ============================================================
// 参考 ClaudeCode getContextWindowForModel() 优先级解析
//
// 设计原则：
// 1. 环境变量优先（THETHING_MODEL_CONTEXT_LIMIT）
// 2. 模型名后缀可指定（如 qwen-max[1m] 表示 1M）
// 3. 简化配置表作为默认值（仅保留常用模型）
// 4. 兜底保守默认值 128K

// 从统一配置模块导入常量
import {
  ENV_CONTEXT_LIMIT,
  ENV_OUTPUT_TOKENS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
} from './config/defaults';

// 重新导出供其他模块使用
export {
  ENV_CONTEXT_LIMIT,
  ENV_OUTPUT_TOKENS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
};

// ============================================================
// 类型定义
// ============================================================

export interface ModelCapabilities {
  /** 上下文窗口限制（tokens） */
  contextLimit: number;
  /** 默认输出预留（tokens） */
  defaultOutputTokens: number;
}

// ============================================================
// 简化配置表（仅保留常用模型的实测值）
// ============================================================

/**
 * 已知模型的上下文限制
 * 来源：实测 + 官方文档
 *
 * 注意：大多数情况下应使用环境变量覆盖，此表仅作为默认值
 */
const KNOWN_MODEL_LIMITS: Record<string, number> = {
  // Qwen 系列（实测值）
  'qwen-max': 1_000_000,
  'qwen-plus': 128_000,
  'qwen-turbo': 128_000,
  'qwen3.5-27b': 258_048,  // 实测错误信息显示的值

  // DeepSeek 系列
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
};

// ============================================================
// 核心函数
// ============================================================

/**
 * 获取模型上下文限制
 *
 * 优先级（参考 ClaudeCode 5级解析）：
 * 1. 环境变量 THETHING_MODEL_CONTEXT_LIMIT（最高优先级）
 * 2. 模型名后缀 [1m]、[512k]、[256k]
 * 3. 已知模型配置表
 * 4. 前缀匹配（如 qwen-* → 128K）
 * 5. 兜底默认值 128K
 */
export function getModelContextLimit(modelName: string): number {
  // 1. 环境变量覆盖（最高优先级）
  const envLimit = process.env[ENV_CONTEXT_LIMIT];
  if (envLimit) {
    const parsed = parseInt(envLimit, 10);
    if (parsed > 0) {
      return parsed;
    }
  }

  if (!modelName) {
    return DEFAULT_CONTEXT_LIMIT;
  }

  // 2. 模型名后缀解析
  if (modelName.includes('[1m]')) {
    return 1_000_000;
  }
  if (modelName.includes('[512k]')) {
    return 512_000;
  }
  if (modelName.includes('[256k]')) {
    return 256_000;
  }

  // 3. 精确匹配已知模型
  const normalized = modelName.toLowerCase().trim();
  if (KNOWN_MODEL_LIMITS[normalized]) {
    return KNOWN_MODEL_LIMITS[normalized];
  }

  // 4. 前缀匹配（简化版：匹配模型系列前缀）
  for (const [knownName, limit] of Object.entries(KNOWN_MODEL_LIMITS)) {
    // 匹配系列前缀（如 qwen-max-latest → qwen-max）
    const seriesPrefix = knownName.split('-').slice(0, 2).join('-');
    if (normalized.startsWith(seriesPrefix)) {
      return limit;
    }
    // 匹配品牌前缀（如 qwen-* → 128K）
    const brandPrefix = knownName.split('-')[0];
    if (normalized.startsWith(brandPrefix + '-') && brandPrefix !== 'default') {
      return limit;
    }
  }

  // 5. 兜底默认值
  return DEFAULT_CONTEXT_LIMIT;
}

/**
 * 获取输出预留 Token 数
 */
export function getDefaultOutputTokens(): number {
  const envOutput = process.env[ENV_OUTPUT_TOKENS];
  if (envOutput) {
    const parsed = parseInt(envOutput, 10);
    if (parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_OUTPUT_TOKENS;
}

/**
 * 获取模型能力配置
 */
export function getModelCapabilities(modelName: string): ModelCapabilities {
  return {
    contextLimit: getModelContextLimit(modelName),
    defaultOutputTokens: getDefaultOutputTokens(),
  };
}

/**
 * 计算有效上下文预算
 * 有效上下文 = 窗口 - 输出预留
 */
export function getEffectiveContextBudget(modelName: string): number {
  const contextLimit = getModelContextLimit(modelName);
  const outputReserve = Math.min(getDefaultOutputTokens(), 20_000);
  return contextLimit - outputReserve;
}

/**
 * 自动压缩触发阈值
 * triggerPoint = effectiveBudget - buffer
 */
export function getAutoCompactThreshold(modelName: string): number {
  return getEffectiveContextBudget(modelName) - AUTOCOMPACT_BUFFER_TOKENS;
}

/**
 * 快速设置模型上下文限制（用于调试或临时调整）
 */
export function setModelContextLimit(limit: number): void {
  process.env[ENV_CONTEXT_LIMIT] = String(limit);
}