// ============================================================
// buildContextBudgetPayload - 上下文预算单一构造点
// ============================================================
// 用途：route.ts 推 SSE / 写 DB 时统一调用本函数。
// 设计参考：docs/context-usage-redesign.md §6
//
// 关键不变式：
// - lastEstimation 为 null 时返回 null（不发脏数据，避免静默 fallback 反馈循环）
// - 返回值永远是 ContextBudgetSnapshot 类型（zod 验证失败 throw）

import {
  ContextBudgetSnapshotSchema,
  type ContextBudgetSnapshot,
  type SessionCostSnapshot,
} from '@the-thing/core';

interface BuildPayloadInput {
  lastEstimation: {
    utilizationPercent: number;
    totalTokens: number;
    modelLimit: number;
    /** 引擎权威口径（含校准 buffer）——A1 显示同源用 */
    totalTokensWithBuffer?: number;
    /** 主动压缩触发线（tokens）——A2 圆环刻度用 */
    triggerTokens?: number;
    /** 强制降级硬限（tokens）——A2 圆环刻度用 */
    hardLimitTokens?: number;
  } | null | undefined;
  compactionTracker: { getSnapshot(): unknown };
  costTracker: {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    totalCost: number;
  };
  source?: 'live' | 'db-loaded';
}

export function buildContextBudgetPayload(input: BuildPayloadInput): ContextBudgetSnapshot | null {
  if (!input.lastEstimation) {
    // INVARIANT: SDK 顺序保证 prepareStep 在 onStepEnd 之前。
    // 走到这里说明 abort/retry 路径未清理；宁可漏推，不发脏数据。
    console.warn('[context-budget] onStepEnd fired before prepareStep; skipping context payload');
    return null;
  }

  const sessionCost: SessionCostSnapshot = {
    inputTokens: input.costTracker.inputTokens,
    outputTokens: input.costTracker.outputTokens,
    cachedReadTokens: input.costTracker.cachedReadTokens,
    totalCostUsd: input.costTracker.totalCost,
  };

  const payload: ContextBudgetSnapshot = {
    utilizationPercent: input.lastEstimation.utilizationPercent,
    totalTokens: input.lastEstimation.totalTokens,
    modelLimit: input.lastEstimation.modelLimit,
    totalTokensWithBuffer: input.lastEstimation.totalTokensWithBuffer,
    triggerTokens: input.lastEstimation.triggerTokens,
    hardLimitTokens: input.lastEstimation.hardLimitTokens,
    compaction: input.compactionTracker.getSnapshot() as ContextBudgetSnapshot['compaction'],
    sessionCost,
    capturedAt: new Date().toISOString(),
    source: input.source ?? 'live',
  };

  // 任何字段不匹配都 throw——不留静默 undefined 的口子
  return ContextBudgetSnapshotSchema.parse(payload);
}

/** 安全版：parse 失败时返回 null 并 log，不抛 */
export function safeBuildContextBudgetPayload(input: BuildPayloadInput): ContextBudgetSnapshot | null {
  try {
    return buildContextBudgetPayload(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[context-budget] payload validation failed', { error: msg });
    return null;
  }
}

/** 接收前端 stream 数据时的安全解析（替换不合法字段为 null） */
export function safeParseContextBudget(data: unknown): ContextBudgetSnapshot | null {
  const result = ContextBudgetSnapshotSchema.safeParse(data);
  if (!result.success) {
    const issueCount = result.error.issues.length;
    console.warn('[context-budget] stream data failed to parse', { issueCount });
    return null;
  }
  return result.data;
}
