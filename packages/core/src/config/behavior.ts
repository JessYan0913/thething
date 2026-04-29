// ============================================================
// Behavior Config - 运行时行为配置
// ============================================================
//
// 这里的每个字段代表调用方做出的业务决策：
// - 调用方比 core 更了解自己的业务场景
// - 这些值由调用方提供，core 只执行
// - 所有字段均有合理默认值，最简场景可以不传任何参数
//

import type { ModelPricing } from '../foundation/model/pricing';

/**
 * 模型规格定义
 */
export interface ModelSpec {
  /** 模型 ID（用于 API 调用） */
  id: string;
  /** 模型显示名称 */
  name: string;
  /**
   * 相对于基准模型的费用倍数
   * 用于自动降级决策：当费用超过阈值时切换到 costMultiplier 更低的模型
   */
  costMultiplier: number;
  /**
   * 能力层级（1=最快最便宜，数字越大能力越强）
   * 用于模型选择逻辑
   */
  capabilityTier: number;
}

/**
 * 运行时行为配置
 *
 * 每个字段代表调用方做出的业务决策，core 只执行。
 * 所有字段均有默认值，最简场景可以不传任何参数。
 *
 * @example
 * // 最简场景（全部默认值）
 * const behavior = buildBehaviorConfig();
 *
 * @example
 * // 企业部署（调整预算上限）
 * const behavior = buildBehaviorConfig({
 *   maxBudgetUsdPerSession: 20.0,
 *   maxStepsPerSession: 100,
 * });
 *
 * @example
 * // 替换模型商
 * const behavior = buildBehaviorConfig({
 *   availableModels: [
 *     { id: 'gpt-4o-mini', name: 'GPT-4o Mini', costMultiplier: 0.1, capabilityTier: 1 },
 *     { id: 'gpt-4o', name: 'GPT-4o', costMultiplier: 1.0, capabilityTier: 3 },
 *   ],
 *   modelAliases: { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' },
 * });
 */
export interface BehaviorConfig {
  // ── 会话控制 ──────────────────────────────────────────────

  /**
   * 单次对话的最大步骤数
   * 防止 Agent 陷入无限循环
   * @default 50
   */
  maxStepsPerSession: number;

  /**
   * 单次对话的最大费用上限（USD）
   * 超出后 Agent 停止工具调用，返回当前进度
   * @default 5.0
   */
  maxBudgetUsdPerSession: number;

  /**
   * 上下文窗口 Token 上限
   * 接近此值时触发压缩
   * @default 128_000
   */
  maxContextTokens: number;

  /**
   * 触发上下文压缩的剩余 Token 阈值
   * 当剩余空间低于此值时开始压缩
   * @default 25_000
   */
  compactionThreshold: number;

  /**
   * 单个工具被拒绝的最大次数
   * 超出后 Agent 停止尝试该工具
   * @default 3
   */
  maxDenialsPerTool: number;

  // ── 模型配置 ──────────────────────────────────────────────

  /**
   * 可用模型列表（按能力层级从低到高排列）
   *
   * core 用此列表实现自动降级：
   * 当费用超过阈值时切换到 costMultiplier 更低的模型
   *
   * 调用方替换成自己的模型商时，替换此列表即可
   */
  availableModels: ModelSpec[];

  /**
   * 模型快捷名称映射
   * 让 Agent 定义文件可以用 'fast'/'smart'/'default' 代替具体模型名
   */
  modelAliases: {
    /** 快速模型（成本低） */
    fast: string;
    /** 智能模型（能力强） */
    smart: string;
    /** 默认模型 */
    default: string;
  };

  /**
   * 自动降级成本阈值（百分比）
   * 当累计费用达到预算的此百分比时，自动切换到更便宜的模型
   * @default 80
   */
  autoDowngradeCostThreshold: number;

  /**
   * 模型定价表（USD / 百万 token）
   * 用于估算费用和触发自动降级
   * 传入值会覆盖内置定价，未覆盖的模型使用内置值
   */
  modelPricing?: Record<string, ModelPricing>;

  // ── 安全策略 ──────────────────────────────────────────────

  /**
   * Agent 无法读写的路径（相对路径，相对于 resourceRoot）
   * 会与内置保护列表（.git、.env 等）合并，不替换
   */
  extraSensitivePaths?: readonly string[];
}

/**
 * 默认模型规格
 */
export const DEFAULT_MODEL_SPECS: ModelSpec[] = [
  { id: 'qwen-turbo', name: 'Qwen Turbo', costMultiplier: 0.1, capabilityTier: 1 },
  { id: 'qwen-plus', name: 'Qwen Plus', costMultiplier: 0.4, capabilityTier: 2 },
  { id: 'qwen-max', name: 'Qwen Max', costMultiplier: 1.0, capabilityTier: 3 },
];

/**
 * 默认模型快捷名映射
 */
export const DEFAULT_MODEL_ALIASES = {
  fast: 'qwen-turbo',
  smart: 'qwen-max',
  default: 'qwen-plus',
};

/**
 * 构建完整的 BehaviorConfig
 *
 * @param partial - 部分配置（未提供的字段使用默认值）
 * @returns 完整的 BehaviorConfig（所有字段已填充）
 *
 * @example
 * const behavior = buildBehaviorConfig({
 *   maxBudgetUsdPerSession: 20.0,
 * });
 */
export function buildBehaviorConfig(partial?: Partial<BehaviorConfig>): BehaviorConfig {
  return {
    maxStepsPerSession: partial?.maxStepsPerSession ?? 50,
    maxBudgetUsdPerSession: partial?.maxBudgetUsdPerSession ?? 5.0,
    maxContextTokens: partial?.maxContextTokens ?? 128_000,
    compactionThreshold: partial?.compactionThreshold ?? 25_000,
    maxDenialsPerTool: partial?.maxDenialsPerTool ?? 3,
    availableModels: partial?.availableModels ?? DEFAULT_MODEL_SPECS,
    modelAliases: partial?.modelAliases ?? DEFAULT_MODEL_ALIASES,
    autoDowngradeCostThreshold: partial?.autoDowngradeCostThreshold ?? 80,
    modelPricing: partial?.modelPricing,
    extraSensitivePaths: partial?.extraSensitivePaths ?? [],
  };
}