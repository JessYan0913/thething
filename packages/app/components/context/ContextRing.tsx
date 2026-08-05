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
  const pct = snapshot.utilizationPercent;
  const color = utilizationColor(pct);
  const isCompacting = snapshot.compaction.state === 'compacting';
  const isJustCompacted = snapshot.compaction.state === 'justCompacted';

  return (
    <div className="flex items-center gap-1">
      <svg width="18" height="18" viewBox="0 0 20 20" className="-rotate-90 shrink-0">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5"
                className="text-muted-foreground/30" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={ringDashOffset(pct)}
                className={cn('transition-all duration-700', color.ring)} />
      </svg>
      <span className={cn('text-xs tabular-nums', color.text)}>
        {displayPercent(pct)}
      </span>
      {isCompacting && (
        <span className="inline-flex items-center gap-1 text-xs text-orange-500 ml-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
          压缩中
        </span>
      )}
      {isJustCompacted && (
        <span className="text-xs text-orange-500 ml-1">已压缩</span>
      )}
    </div>
  );
}
