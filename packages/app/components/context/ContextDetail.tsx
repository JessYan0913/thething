// ============================================================
// ContextDetail - 上下文预算详情面板
// ============================================================
// 设计参考：docs/context-usage-redesign.md §8.3

import { cn } from '@/lib/utils';
import type { ContextBudgetSnapshot } from '@the-thing/core/context-budget';
import { buildDetailRows } from './format';

export function ContextDetail({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  const rows = buildDetailRows(snapshot);
  return (
    <div className="space-y-2 text-xs">
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
