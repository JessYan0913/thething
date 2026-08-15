// ============================================================
// ContextDetail - 上下文预算详情面板（分段进度条布局）
// ============================================================
// 设计参考：docs/plans/2026-08-16-context-usage-display-redesign.md
// 布局：历史提示 → 分段进度条(构成 + 黄/红刻度 + 右侧%) → 图例 → 距触发线 → 详情行

import { cn } from '@/lib/utils';
import type { ContextBudgetSnapshot } from '@the-thing/core/context-budget';
import {
  buildDetailRows,
  buildSegments,
  clampPercent,
  displayPercent,
  distanceToTrigger,
  formatTokens,
  utilizationColor,
} from './format';

export function ContextDetail({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  const rows = buildDetailRows(snapshot);
  return (
    <div className="space-y-2 text-xs">
      {snapshot.source === 'db-loaded' && (
        <div className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
          历史快照：无触发/硬限刻度与构成明细（旧数据未存引擎字段）
        </div>
      )}
      <UsageBar snapshot={snapshot} />
      <Legend snapshot={snapshot} />
      <DistanceRow snapshot={snapshot} />
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

/** 分段进度条：构成分段填充 + trigger(黄)/hardLimit(红) 刻度 + 右侧主百分比 */
function UsageBar({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  const limit = snapshot.modelLimit || 1;
  const total = snapshot.totalTokensWithBuffer ?? snapshot.totalTokens;
  const pct = clampPercent((total / limit) * 100);
  const trigger = snapshot.triggerTokens != null ? clampPercent((snapshot.triggerTokens / limit) * 100) : null;
  const hard = snapshot.hardLimitTokens != null ? clampPercent((snapshot.hardLimitTokens / limit) * 100) : null;
  const segments = buildSegments(snapshot);
  const color = utilizationColor(pct, trigger, hard);

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="relative h-2 flex-1"
        title={`使用 ${pct.toFixed(0)}% · 触发 ${trigger != null ? trigger.toFixed(0) : '—'}% · 硬限 ${hard != null ? hard.toFixed(0) : '—'}%`}
      >
        {/* 分段填充：overflow-hidden 保持圆角，刻度线放外层容器避免被裁 */}
        <div className="absolute inset-0 overflow-hidden rounded-full bg-muted">
          <div className="flex h-full">
            {segments.map((s) => (
              <div key={s.key} className={cn('transition-all duration-500', s.className)} style={{ width: `${s.pct}%` }} />
            ))}
          </div>
        </div>
        {trigger != null && (
          <span className="absolute top-0 h-full w-[2px] -translate-x-1/2 bg-yellow-500" style={{ left: `${trigger}%` }} />
        )}
        {hard != null && (
          <span className="absolute top-0 h-full w-[2px] -translate-x-1/2 bg-red-500" style={{ left: `${hard}%` }} />
        )}
      </div>
      <span className={cn('shrink-0 text-xs tabular-nums', color.text)}>{displayPercent(pct)}</span>
    </div>
  );
}

/** 图例：各构成分段的颜色标签 */
function Legend({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  const segments = buildSegments(snapshot);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {segments.map((s) => (
        <span key={s.key} className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-sm', s.className)} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** 距触发线：trigger − 当前使用；已过线显示"已触发"，超硬限显示"已超硬限" */
function DistanceRow({ snapshot }: { snapshot: ContextBudgetSnapshot }) {
  const dist = distanceToTrigger(snapshot);
  if (dist == null) return null;
  const total = snapshot.totalTokensWithBuffer ?? snapshot.totalTokens;
  const overHard = snapshot.hardLimitTokens != null && total >= snapshot.hardLimitTokens;
  let value: string;
  let cls: string;
  if (overHard) {
    value = '已超硬限';
    cls = 'text-destructive';
  } else if (dist.triggered) {
    value = '已触发';
    cls = 'text-yellow-500';
  } else {
    value = `还剩 ${displayPercent(dist.pct)} · 约 ${formatTokens(dist.tokens)}`;
    cls = '';
  }
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">距触发线</span>
      <span className={cn('tabular-nums', cls)}>{value}</span>
    </div>
  );
}
