// ============================================================
// ContextBudgetSnapshot - 上下文预算快照（单一类型源）
// ============================================================
// 三方真相源的统一载体：
// - estimation 维度（窗口使用率）: utilizationPercent, totalTokens, modelLimit
// - compaction 维度（事件累计）: state, compactionsCount, totalFreed
// - cost 维度（计费累计）: inputTokens, outputTokens, cachedReadTokens, totalCostUsd
//
// 任何边界（Core→DB, DB→Frontend, SSE→UI）都用 .parse() 验证。
// 任何字段不匹配都 throw，不留静默 undefined 的口子。
//
// 设计参考：docs/context-usage-redesign.md §5

import { z } from 'zod';
import { CompactionSnapshotSchema } from '../../modules/compaction/state-tracker';

/** 会话计费累计快照（来自 CostTracker） */
export const SessionCostSnapshotSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedReadTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
});
export type SessionCostSnapshot = z.infer<typeof SessionCostSnapshotSchema>;

/** 上下文预算快照的元数据 */
const ContextBudgetSource = z.enum(['live', 'db-loaded']);

/** 完整快照 */
export const ContextBudgetSnapshotSchema = z.object({
  // === estimation 维度（窗口使用率，0-100） ===
  utilizationPercent: z.number().min(0).max(100),
  totalTokens: z.number().int().nonnegative(),
  modelLimit: z.number().int().positive(),

  // === compaction 维度（事件累计） ===
  compaction: CompactionSnapshotSchema,

  // === cost 维度（计费累计） ===
  sessionCost: SessionCostSnapshotSchema,

  // === 元数据 ===
  capturedAt: z.string().refine(
    (s) => !Number.isNaN(Date.parse(s)),
    { message: 'capturedAt must be ISO 8601 datetime' }
  ),
  source: ContextBudgetSource,
});
export type ContextBudgetSnapshot = z.infer<typeof ContextBudgetSnapshotSchema>;
export type ContextBudgetSource = z.infer<typeof ContextBudgetSource>;
