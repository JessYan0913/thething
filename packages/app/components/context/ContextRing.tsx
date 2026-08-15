// ============================================================
// ContextRing - 上下文使用率圆环（最小可用）
// ============================================================
// 设计参考：docs/context-usage-redesign.md §8.2
// 利用 ContextBudgetSnapshotSchema 保证 utilizationPercent ∈ [0, 100]，
// 圆环文字无需 Math.min(100, ...) 二次 clamp。

import { cn } from '@/lib/utils';
import type { ContextBudgetSnapshot } from '@the-thing/core/context-budget';
import { displayPercent, ringDashOffset, utilizationColor } from './format';

export function ContextRing({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  const limit = snapshot.modelLimit || 1;
  // A1 显示同源：优先引擎权威口径（含校准 buffer），无则回落 base 总量
  const total = snapshot.totalTokensWithBuffer ?? snapshot.totalTokens;
  const pct = (total / limit) * 100;

  // A2 刻度：trigger（黄）/ hardLimit（红）在圆环上的位置
  const triggerPct = snapshot.triggerTokens != null ? (snapshot.triggerTokens / limit) * 100 : null;
  const hardPct = snapshot.hardLimitTokens != null ? (snapshot.hardLimitTokens / limit) * 100 : null;
  // 颜色与引擎触发点同源：达触发线变黄、达硬限变红（无刻度时回落通用阈值）
  const color = utilizationColor(pct, triggerPct, hardPct);
  const tick = (p: number) => {
    const a = (Math.min(100, Math.max(0, p)) / 100) * 2 * Math.PI;
    return { x: 10 + 8 * Math.sin(a), y: 10 - 8 * Math.cos(a) };
  };

  return (
    <div className="flex items-center gap-1">
      <svg width="18" height="18" viewBox="0 0 20 20" className="-rotate-90 shrink-0">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5"
                className="text-muted-foreground/30" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={ringDashOffset(pct)}
                className={cn('transition-all duration-700', color.ring)} />
        {triggerPct != null && (
          <circle cx={tick(triggerPct).x} cy={tick(triggerPct).y} r="0.9" fill="currentColor"
                  className="text-yellow-500" />
        )}
        {hardPct != null && (
          <circle cx={tick(hardPct).x} cy={tick(hardPct).y} r="0.9" fill="currentColor"
                  className="text-red-500" />
        )}
      </svg>
      <span className={cn('text-xs tabular-nums', color.text)}>
        {displayPercent(pct)}
      </span>
    </div>
  );
}
