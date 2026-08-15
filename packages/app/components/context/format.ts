// ============================================================
// format - 上下文预算展示层纯函数（唯一允许 Math.min 的位置）
// ============================================================
// 设计参考：docs/context-usage-redesign.md §8.4 + 原则 7
// 全代码库 grep "Math.min(100," 只允许出现在本文件。

import type { ContextBudgetSnapshot, SessionCostSnapshot } from '@the-thing/core/context-budget';

const K = 1000;

/** 把 tokens 数量格式化为 "1.2K" / "3.4M" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= K) return `${(n / K).toFixed(1)}K`;
  return String(n);
}

/**
 * 缓存命中率 = cachedReadTokens / (inputTokens + cachedReadTokens)
 * 没有 input 时显示 "—"
 */
export function formatCacheHitRate(sessionCost: Pick<SessionCostSnapshot, 'inputTokens' | 'cachedReadTokens'>): string {
  const totalInput = sessionCost.inputTokens + sessionCost.cachedReadTokens;
  if (totalInput === 0) return '—';
  return `${((sessionCost.cachedReadTokens / totalInput) * 100).toFixed(2)}%`;
}

/**
 * 把 utilizationPercent 映射到颜色档位。
 * 唯一允许的颜色规则定义点。
 */
export function utilizationColor(pct: number): {
  text: string;
  ring: string;
  bar: string;
  threshold: 'critical' | 'high' | 'normal';
} {
  if (pct > 80) return { text: 'text-destructive', ring: 'text-destructive', bar: 'bg-destructive', threshold: 'critical' };
  if (pct > 60) return { text: 'text-yellow-500', ring: 'text-yellow-500', bar: 'bg-yellow-500', threshold: 'high' };
  return { text: 'text-primary/60', ring: 'text-primary/60', bar: 'bg-primary/60', threshold: 'normal' };
}

/** 整圆周长（用于 SVG dasharray） */
const CIRCUMFERENCE = 2 * Math.PI * 8; // r=8 → 50.27

/** 计算 SVG 圆环 dasharray 值 */
export function ringDashOffset(pct: number): string {
  // 唯一允许的 Math.min 出现位置
  const safe = Math.min(100, Math.max(0, pct));
  return `${(safe / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
}

/** 整数字符串（schema 已保证 0-100，但保留容错） */
export function displayPercent(pct: number): string {
  return `${Math.min(100, Math.max(0, pct)).toFixed(0)}%`;
}

/** 把 0-100 百分比 clamp 到 [0,100]，供进度条宽度/刻度定位用（唯一允许 Math.min 的位置） */
export function clampPercent(pct: number): number {
  return Math.min(100, Math.max(0, pct));
}

/** 把 snapshot 渲染为详情面板用 row 数据 */
export interface DetailRow {
  label: string;
  value: string;
  highlight?: boolean;
}

export function buildDetailRows(snapshot: ContextBudgetSnapshot): DetailRow[] {
  // A1 显示同源：详情面板与圆环用同一口径（含校准 buffer）
  const limit = snapshot.modelLimit || 1;
  const total = snapshot.totalTokensWithBuffer ?? snapshot.totalTokens;
  const pct = (total / limit) * 100;
  const rows: DetailRow[] = [
    { label: '当前使用', value: displayPercent(pct), highlight: true },
    { label: '窗口', value: `${formatTokens(total)} / ${formatTokens(snapshot.modelLimit)}` },
  ];
  // A2 刻度与引擎行为对齐：优先引擎推导的 trigger/hardLimit（百分比 + tokens），
  // 旧数据/DB-loaded 无此字段时回落 compaction.triggerPercent。
  if (snapshot.triggerTokens != null && snapshot.hardLimitTokens != null) {
    rows.push(
      { label: '触发阈值', value: `${displayPercent((snapshot.triggerTokens / limit) * 100)}（${formatTokens(snapshot.triggerTokens)}）` },
      { label: '强制硬限', value: `${displayPercent((snapshot.hardLimitTokens / limit) * 100)}（${formatTokens(snapshot.hardLimitTokens)}）` },
    );
  } else {
    rows.push({ label: '压缩阈值', value: `${(snapshot.compaction.triggerPercent * 100).toFixed(0)}%` });
  }
  rows.push(
    { label: '已压缩', value: `${snapshot.compaction.compactionsCount} 次 · 释放 ${formatTokens(snapshot.compaction.totalFreed)}` },
    {
      label: '缓存命中率',
      value: `${formatCacheHitRate(snapshot.sessionCost)} · ${formatTokens(snapshot.sessionCost.cachedReadTokens)} tokens`,
    },
  );
  return rows;
}
