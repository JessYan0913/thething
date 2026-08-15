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
 * 有引擎刻度（trigger/hard）时颜色对齐触发点：<触发 正常 / 触发~硬限 高 / ≥硬限 危险；
 * 无刻度（DB-loaded 旧会话）时回落通用使用量阈值（>60 黄 / >80 红）。
 */
export function utilizationColor(
  pct: number,
  triggerPct?: number | null,
  hardPct?: number | null,
): {
  text: string;
  ring: string;
  bar: string;
  threshold: 'critical' | 'high' | 'normal';
} {
  const trigger = triggerPct ?? 60;
  const hard = hardPct ?? 80;
  if (pct >= hard) return { text: 'text-destructive', ring: 'text-destructive', bar: 'bg-destructive', threshold: 'critical' };
  if (pct >= trigger) return { text: 'text-yellow-500', ring: 'text-yellow-500', bar: 'bg-yellow-500', threshold: 'high' };
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

/** 进度条分段（构成明细） */
export interface Segment {
  key: 'input' | 'tools' | 'output' | 'calib';
  label: string;
  tokens: number;
  /** 相对 modelLimit 的百分比（进度条宽度，clamp 0-100） */
  pct: number;
  /** 分段颜色 class */
  className: string;
}

/**
 * 构成分段：纯输入 / 工具 / 输出预留 / 校准 buffer，各占窗口比例。
 * 四段之和 = totalTokensWithBuffer，进度条总长 = 主百分比（同一坐标系），
 * 黄线(trigger)/红线(hard)刻度可直接贯穿。
 * 无构成字段（DB-loaded 旧会话）时退化为单段（总占用，颜色走 utilizationColor）。
 */
export function buildSegments(snapshot: ContextBudgetSnapshot): Segment[] {
  const limit = snapshot.modelLimit || 1;
  const hasDetail =
    snapshot.messagesTokens != null ||
    snapshot.instructionsTokens != null ||
    snapshot.toolsTokens != null ||
    snapshot.tokenizerBuffer != null ||
    snapshot.outputReserve != null;

  if (!hasDetail) {
    const total = snapshot.totalTokensWithBuffer ?? snapshot.totalTokens;
    return [{
      key: 'input',
      label: '使用',
      tokens: total,
      pct: clampPercent((total / limit) * 100),
      className: 'bg-primary/60',
    }];
  }

  const push = (key: Segment['key'], label: string, tokens: number, className: string) => {
    if (tokens > 0) segs.push({ key, label, tokens, pct: clampPercent((tokens / limit) * 100), className });
  };
  const segs: Segment[] = [];
  push('input', '纯输入', (snapshot.messagesTokens ?? 0) + (snapshot.instructionsTokens ?? 0), 'bg-primary/70');
  push('tools', '工具', snapshot.toolsTokens ?? 0, 'bg-primary/40');
  push('output', '输出预留', snapshot.outputReserve ?? 0, 'bg-muted-foreground/50');
  push('calib', '校准', snapshot.tokenizerBuffer ?? 0, 'bg-muted-foreground/25');
  // 空会话全 0：保底一个空段，避免进度条无内容/图例无项
  if (segs.length === 0) {
    segs.push({ key: 'input', label: '纯输入', tokens: 0, pct: 0, className: 'bg-primary/70' });
  }
  return segs;
}

/** 距触发线的距离（tokens + 窗口百分比）。无 trigger（DB-loaded）时 null。 */
export function distanceToTrigger(snapshot: ContextBudgetSnapshot): {
  tokens: number;
  pct: number;
  triggered: boolean;
} | null {
  if (snapshot.triggerTokens == null) return null;
  const total = snapshot.totalTokensWithBuffer ?? snapshot.totalTokens;
  const tokens = snapshot.triggerTokens - total;
  const limit = snapshot.modelLimit || 1;
  return { tokens, pct: (tokens / limit) * 100, triggered: tokens <= 0 };
}

/** 详情行：压缩历史 + 缓存/成本。窗口/触发/硬限数字行已被进度条分段+刻度取代。 */
export function buildDetailRows(snapshot: ContextBudgetSnapshot): DetailRow[] {
  return [
    { label: '已压缩', value: `${snapshot.compaction.compactionsCount} 次 · 释放 ${formatTokens(snapshot.compaction.totalFreed)}` },
    {
      label: '缓存命中率',
      value: `${formatCacheHitRate(snapshot.sessionCost)} · ${formatTokens(snapshot.sessionCost.cachedReadTokens)} tokens`,
    },
    { label: '本会话成本', value: `$${snapshot.sessionCost.totalCostUsd.toFixed(2)}` },
  ];
}
