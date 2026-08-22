// ============================================================
// Prompt Budget Policy - 触发线 / 硬限 / 目标的单一来源
// ============================================================
// 估算地基 + 统一预算策略（见 docs/compaction-redesign.md L1）：
//
//   effectiveBudget = contextLimit − outputReserve
//   bufferTokens    = max(误差距离, 反应空间, EMERGENCY_BUFFER)，受 MAX_BUFFER 封顶
//                     误差距离 = clamp(effectiveBudget × ratio, min, max)
//                                 精确 4%·min2000 / 近似 8%·min3000 / 字符 15%·min5000
//                     反应空间 = min(effectiveBudget × 10%, 30000)  ← 触发→压缩执行间的增长
//   triggerTokens   = contextLimit − bufferTokens     ← 达到即主动升档压缩
//   hardLimitTokens = contextLimit − 3000             ← 超过强制降级
//
// trigger/hard 采用窗口坐标系（含 outputReserve），与 request-budget 的
// totalTokensWithBuffer（= 纯输入 + outputReserve + 校准buffer）对齐比较，
// 避免 outputReserve 双计（从阈值扣除又加到比较量上）。触发时纯输入 =
// contextLimit − buffer − outputReserve = effectiveBudget − buffer，即 docs 的
// 输入触发线；UI 黄线 trigger/contextLimit 与进度条填充同口径。
//
// buffer 下限为 EMERGENCY_BUFFER：保证 triggerTokens ≤ hardLimitTokens。
// 若 buffer < 3000（exact 小窗口被 min=2000 兜底），红点会跑到黄点左边、
// shouldForce 先于 shouldTrigger 触发——主动升档压缩永远执行不到。
//
// 反应空间解决"exact 128k–256k 触发点过晚"：纯误差 buffer（exact 仅 4%）把
// 黄线推到窗口 90–96%，黄→红只剩 1.8k–5k tokens，一次大工具输出就冲过红线、
// 主动压缩来不及执行。叠加 10% 反应空间后触发点回到 ~85%，黄→红拉开到
// 9k–17k；1M 窗口由误差 buffer（4%）主导，reaction 被 30k 封顶，触发点不变。
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
/** 反应空间：触发→压缩执行期间的可能增长（effectiveBudget 比例，封顶防超大窗口浪费） */
const REACTION_RATIO = 0.1;
const REACTION_MAX_BUFFER = 30_000;

/** 常规压缩目标水位（压缩后应回到此水位附近） */
export const DEFAULT_TARGET_PERCENT = 0.7;
/** 紧急压缩目标水位（applyEmergencyCompression 使用） */
export const EMERGENCY_TARGET_PERCENT = 0.6;
/** 压缩目标中"消息"部分的下限（防止小窗口下消息预算为 0 → 全历史摘要化/过度压缩） */
export const MIN_MESSAGE_BUDGET_TOKENS = 2000;

// 注：outputReserve = 固定默认值（DEFAULT_OUTPUT_TOKENS），纯预算估算、不是 provider 上限。
// 2026-08-22 起学 pi：输出上限交给 provider 默认（模型未声明则不发送 maxOutputTokens），
// 输出截断（finishReason=length）由 run 终态 output_truncated 兜底，不再在配置层设硬顶。
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
  // 反应空间：触发→压缩执行期间的增长下限。超大窗口被 REACTION_MAX_BUFFER 封顶，
  // 让 1M 窗口由精确度 buffer（exact 4%）主导，避免提前到浪费性水位。
  const reactionBuffer = Math.min(
    REACTION_MAX_BUFFER,
    Math.floor(effectiveBudget * REACTION_RATIO),
  );
  const bufferTokens = Math.min(
    MAX_BUFFER,
    Math.max(
      MIN_BUFFER[level],
      Math.floor(effectiveBudget * BUFFER_RATIO[level]),
      EMERGENCY_BUFFER, // buffer 下限 ≥ 紧急缓冲 → trigger ≤ hard（防红黄倒置）
      reactionBuffer, // 反应空间下限 → exact/approximate 128k–256k 触发点回到 ~85%
    ),
  );
  const triggerTokens = Math.max(0, contextLimit - bufferTokens);
  const hardLimitTokens = Math.max(0, contextLimit - EMERGENCY_BUFFER);
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
