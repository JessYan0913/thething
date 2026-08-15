// ============================================================
// Prompt Budget Policy - 触发线 / 硬限 / 目标的单一来源
// ============================================================
// 估算地基 + 统一预算策略（见 docs/compaction-redesign.md L1）：
//
//   effectiveBudget = contextLimit − outputReserve
//   bufferTokens    = clamp(effectiveBudget × ratio, min, max)
//                     精确 4%·min2000 / 近似 8%·min3000 / 字符 15%·min5000
//   triggerTokens   = effectiveBudget − bufferTokens     ← 达到即主动升档压缩
//   hardLimitTokens = effectiveBudget − 3000             ← 超过强制降级
//
// buffer 比率按模型估算级别（encoding-registry）选择：精确 tokenizer 偏差最小，
// 已知模型族用 cl100k 近似偏差较大，未知模型字符估算偏差最大。
// 冷启动时静态 buffer 兜底；usage 真值校准接管后由 request-budget 叠加
// tokenizerBuffer。
//
// 所有压缩决策点（manageCompaction / budget-check / retry / UI 水位）只从
// 本模块取数，禁止散落魔法阈值。

import { getEncodingLevel, type EncodingLevel } from '../../primitives/tokenizer';

export interface BudgetPolicy {
  contextLimit: number;
  outputReserve: number;
  /** contextLimit − outputReserve（请求可用的输入预算） */
  effectiveBudget: number;
  /** 触发线安全距离（clamp 后，静态兜底） */
  bufferTokens: number;
  /** 达到即主动升档压缩 */
  triggerTokens: number;
  /** 超过强制降级（紧急缓冲区 3000） */
  hardLimitTokens: number;
}

const BUFFER_RATIO: Record<EncodingLevel, number> = {
  exact: 0.04,
  approximate: 0.08,
  char: 0.15,
};

const MIN_BUFFER: Record<EncodingLevel, number> = {
  exact: 2000,
  approximate: 3000,
  char: 5000,
};

const MAX_BUFFER = 50_000;
/** 硬限与 effectiveBudget 之间的紧急缓冲 */
const EMERGENCY_BUFFER = 3000;

/** 常规压缩目标水位（压缩后应回到此水位附近） */
export const DEFAULT_TARGET_PERCENT = 0.7;
/** 紧急压缩目标水位（applyEmergencyCompression 使用） */
export const EMERGENCY_TARGET_PERCENT = 0.6;
/** 压缩目标中"消息"部分的下限（防止小窗口下消息预算为 0 → 全历史摘要化/过度压缩） */
export const MIN_MESSAGE_BUDGET_TOKENS = 2000;

// 注：动态 outputReserve（§10.4.1）的正确实现 = reserve = min(per-model outputTokens, availableWindow)。
// 需把 models 配置穿进估算层（estimateRequestBudget/estimateFullRequest 加 outputTokens 参数）。
// 曾试过"窗口比例 15%"：低估模型输出能力、把触发点后移，反而让截断风险回来——已回滚。

/**
 * 触发线 / 硬限推导（纯函数）。
 *
 * @param contextLimit 模型上下文窗口（或用户 override）
 * @param outputReserve 输出预留 tokens
 * @param modelName 模型名（决定 encode-level，进而决定 buffer 比率）
 */
export function deriveBudget(
  contextLimit: number,
  outputReserve: number,
  modelName?: string,
): BudgetPolicy {
  const effectiveBudget = Math.max(0, contextLimit - outputReserve);
  const level = getEncodingLevel(modelName);
  const bufferTokens = Math.min(
    MAX_BUFFER,
    Math.max(MIN_BUFFER[level], Math.floor(effectiveBudget * BUFFER_RATIO[level])),
  );
  const triggerTokens = Math.max(0, effectiveBudget - bufferTokens);
  const hardLimitTokens = Math.max(0, effectiveBudget - EMERGENCY_BUFFER);
  return { contextLimit, outputReserve, effectiveBudget, bufferTokens, triggerTokens, hardLimitTokens };
}

/**
 * 压缩后目标 tokens（targetPercent 默认 0.7）。
 * 调用方把请求压到不超过此值。
 */
export function targetTokensFor(contextLimit: number, targetPercent: number = DEFAULT_TARGET_PERCENT): number {
  return Math.floor(contextLimit * targetPercent);
}

/**
 * 压缩目标中"消息"部分的预算 = 目标请求 tokens − 固定开销
 * （instructions + tools + outputReserve），带下限保护。
 *
 * 小窗口（如 22.8k）且固定开销占比高时，原始计算可能为负/0 → 若不设下限，
 * 强制截断会把几乎所有历史都砍掉，对话退化为"一串摘要"。下限保证至少保留
 * 一部分消息；仍无法 fit 时由闸门（硬不变量）兜底拒绝。
 */
export function messageTargetTokensFor(targetRequestTokens: number, fixedOverhead: number): number {
  const raw = targetRequestTokens - fixedOverhead;
  return Math.max(MIN_MESSAGE_BUDGET_TOKENS, raw);
}
