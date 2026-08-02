// ============================================================
// Behavior Config - 运行时行为配置
// ============================================================
//
// 这里的每个字段代表调用方做出的业务决策：
// - 调用方比 core 更了解自己的业务场景
// - 这些值由调用方提供，core 只执行
// - 所有字段均有合理默认值，最简场景可以不传任何参数
//

import type { ModelPricing } from '../model/pricing';
import type { ModelAliases } from '../model';
import {
  DEFAULT_CONTEXT_LIMIT,
} from '../model/constants';
import {
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MAX_DENIALS_PER_TOOL,
  COMPACT_TOKEN_THRESHOLD,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
  MEMORY_MD_MAX_LINES,
  MEMORY_MD_MAX_SIZE_KB,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
} from './defaults';

/**
 * 模型规格定义
 * @deprecated ModelSwapper 已删除;仅 pricing 相关字段仍被 createPricingResolver 使用
 */
export interface ModelSpec {
  /** 模型 ID（用于 API 调用） */
  id: string;
  /** 模型显示名称 */
  name: string;
  /**
   * 上下文窗口大小（Token 数）
   * 用于自动压缩和上下文管理
   */
  contextLimit?: number;

  /**
   * 模型定价（USD / 百万 token）
   * 用于估算费用
   */
  pricing?: {
    input: number;
    output: number;
    cached?: number;
  };
}

import type { CompactionConfig } from './compaction-types';

export type { CompactionConfig };

/**
 * Memory 大小限制配置
 * 注意：这只描述限制，不描述 memory 目录位置
 */
export interface MemoryLimitsConfig {
  /** MEMORY.md 最大行数 */
  mdMaxLines: number;
  /** MEMORY.md 最大大小（KB） */
  mdMaxSizeKb: number;
  /** Memory 入口文件最大行数 */
  entrypointMaxLines: number;
  /** Memory 入口文件最大字节 */
  entrypointMaxBytes: number;
}

/**
 * 工具输出大小限制配置
 * 注意：与 runtime/budget/tool-output-manager.ts 的 ToolOutputConfig（单工具配置）不同
 */
export interface ToolOutputLimitsConfig {
  /** 默认最大结果字符数 */
  maxResultSizeChars: number;
  /** 最大工具结果 Token 数 */
  maxToolResultTokens: number;
  /** 单轮消息中所有工具结果总额上限（字符） */
  maxToolResultsPerMessageChars: number;
  /** 预览内容大小（字符） */
  previewSizeChars: number;
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
 * // 替换模型商（别名映射由新配置 models/backgroundModel 构造,见 buildModelAliases）
 * const behavior = buildBehaviorConfig({
 *   modelAliases: { fast: { model: 'gpt-4o-mini' }, smart: { model: 'gpt-4o' }, default: { model: 'gpt-4o' } },
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
   * 模型快捷名称映射
   * 让 Agent/Skill 定义文件可以用 'fast'（后台任务模型）代替具体模型名;
   * 'smart'/'default' 语义上等价于跟随会话主模型（见 services/model/alias.ts）
   */
  modelAliases: ModelAliases;

  /**
   * 模型定价表（USD / 百万 token）
   * 用于估算费用
   * 传入值会覆盖内置定价，未覆盖的模型使用内置值
   */
  modelPricing?: Record<string, ModelPricing>;

  // ── 安全策略 ──────────────────────────────────────────────

  /**
   * Agent 无法读写的路径（相对路径，相对于 resourceRoot）
   * 会与内置保护列表（.git、.env 等）合并，不替换
   */
  extraSensitivePaths?: readonly string[];

  // ── 压缩配置 ──────────────────────────────────────────────

  /**
   * Compaction 配置
   * 控制对话历史的压缩行为
   */
  compaction: CompactionConfig;

  // ── 工具输出限制 ──────────────────────────────────────────────

  /**
   * 工具输出大小限制
   * 控制工具返回内容的截断行为
   */
  toolOutput: ToolOutputLimitsConfig;

  // ── Memory 系统限制 ──────────────────────────────────────────────

  /**
   * Memory 系统大小限制
   * 控制 MEMORY.md 和入口文件的加载行为
   */
  memory: MemoryLimitsConfig;
}

/**
 * 默认 memory 入口限制
 */
export const DEFAULT_MEMORY_ENTRYPOINT_LIMITS = {
  maxLines: 200,
  maxBytes: 25_000,
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
    maxBudgetUsdPerSession: partial?.maxBudgetUsdPerSession ?? DEFAULT_MAX_BUDGET_USD,
    maxContextTokens: partial?.maxContextTokens ?? DEFAULT_CONTEXT_LIMIT,
    compactionThreshold: partial?.compactionThreshold ?? COMPACT_TOKEN_THRESHOLD,
    maxDenialsPerTool: partial?.maxDenialsPerTool ?? DEFAULT_MAX_DENIALS_PER_TOOL,
    modelAliases: partial?.modelAliases ?? {
      fast: { model: '' },
      smart: { model: '' },
      default: { model: '' },
    },
    modelPricing: partial?.modelPricing,
    extraSensitivePaths: partial?.extraSensitivePaths ?? ([] as readonly string[]),
    // 压缩配置
    compaction: partial?.compaction ?? {
      lifecycle: {
        keepRecentSteps: 3,
        largeOutputThreshold: 8000,
        compactableTools: null,
        protectedTools: new Set(),
      },
      contextWindow: {
        triggerPercent: 0.85,
        targetPercent: 0.7,
        contextHintMessages: 3,
        incrementalSummary: false,
      },
    },
    // 新增：工具输出限制
    toolOutput: partial?.toolOutput ?? {
      maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
      maxToolResultTokens: MAX_TOOL_RESULT_TOKENS,
      maxToolResultsPerMessageChars: MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
      previewSizeChars: PREVIEW_SIZE_CHARS,
    },
    // 新增：Memory 系统限制
    memory: partial?.memory ?? {
      mdMaxLines: MEMORY_MD_MAX_LINES,
      mdMaxSizeKb: MEMORY_MD_MAX_SIZE_KB,
      entrypointMaxLines: MAX_ENTRYPOINT_LINES,
      entrypointMaxBytes: MAX_ENTRYPOINT_BYTES,
    },
  };
}
