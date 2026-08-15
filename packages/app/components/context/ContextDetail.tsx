// ============================================================
// ContextDetail - 上下文预算详情面板
// ============================================================
// 设计参考：docs/context-usage-redesign.md §8.3
// A2 可视化：面板顶部加水平进度条，黄=触发阈值 / 红=强制硬限刻度。

import { cn } from '@/lib/utils';
import type { ContextBudgetSnapshot } from '@the-thing/core/context-budget';
import { buildDetailRows, clampPercent, utilizationColor } from './format';

export function ContextDetail({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  const rows = buildDetailRows(snapshot);
  return (
    <div className="space-y-2 text-xs">
      <UsageBar snapshot={snapshot} />
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between">
          <span className="text-muted-foreground">{row.label}</span>
          <span className={cn('tabular-nums', row.highlight && 'font-semibold')}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 水平进度条：当前使用填充 + trigger(黄)/hardLimit(红) 刻度线 */
function UsageBar({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  const limit = snapshot.modelLimit || 1;
  const total = snapshot.totalTokensWithBuffer ?? snapshot.totalTokens;
  const pct = clampPercent((total / limit) * 100);
  const trigger = snapshot.triggerTokens != null ? clampPercent((snapshot.triggerTokens / limit) * 100) : null;
  const hard = snapshot.hardLimitTokens != null ? clampPercent((snapshot.hardLimitTokens / limit) * 100) : null;

  return (
    <div
      className="relative h-1.5 w-full rounded-full bg-muted"
      title={`使用 ${pct.toFixed(0)}% · 触发 ${trigger != null ? trigger.toFixed(0) : '—'}% · 硬限 ${hard != null ? hard.toFixed(0) : '—'}%`}
    >
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', utilizationColor(pct).bar)}
        style={{ width: `${pct}%` }}
      />
      {trigger != null && (
        <span className="absolute top-0 h-full w-[2px] -translate-x-1/2 bg-yellow-500" style={{ left: `${trigger}%` }} />
      )}
      {hard != null && (
        <span className="absolute top-0 h-full w-[2px] -translate-x-1/2 bg-red-500" style={{ left: `${hard}%` }} />
      )}
    </div>
  );
}
