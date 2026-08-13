'use client';

// Doctor 报告面板：/doctor 指令的渲染层（状态驱动，不入消息流）。
// 报告先行、修复可选：safe 项 confirm:false 直接执行；
// destructive 项返回 needs-confirmation，面板内二次确认再发 confirm:true。

import { useCallback, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Stethoscope,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DoctorReport, RepairOutcome } from '@the-thing/core';

const CATEGORY_LABELS: Record<DoctorReport['checks'][number]['category'], string> = {
  database: '数据库',
  'data-dir': '数据目录',
  wiki: 'Wiki',
  'secondary-db': '次要数据库',
};

const STATUS_ICON = {
  ok: { Icon: CheckCircle2, className: 'text-green-600' },
  warn: { Icon: AlertTriangle, className: 'text-yellow-600' },
  error: { Icon: XCircle, className: 'text-red-600' },
} as const;

interface DoctorReportPanelProps {
  report: DoctorReport | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRepair: (repairId: string, confirm: boolean) => Promise<RepairOutcome>;
}

export function DoctorReportPanel({ report, loading, error, onClose, onRepair }: DoctorReportPanelProps) {
  const [repairing, setRepairing] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ repairId: string; message: string } | null>(null);
  const [allConfirm, setAllConfirm] = useState<{ repairId: string; message: string }[] | null>(null);

  const runRepair = useCallback(
    async (repairId: string, confirm: boolean) => {
      setRepairing(true);
      try {
        const outcome = await onRepair(repairId, confirm);
        if (outcome.status === 'needs-confirmation') {
          setPendingConfirm({ repairId, message: outcome.message });
        } else {
          setPendingConfirm(null);
        }
      } finally {
        setRepairing(false);
      }
    },
    [onRepair],
  );

  const runAll = useCallback(async () => {
    if (!report) return;
    setRepairing(true);
    setAllConfirm(null);
    const fixIds = [...new Set(report.checks.filter((c) => c.fixHint).map((c) => c.fixHint!))];
    const needs: { repairId: string; message: string }[] = [];
    for (const id of fixIds) {
      const outcome = await onRepair(id, false);
      if (outcome.status === 'needs-confirmation') needs.push({ repairId: id, message: outcome.message });
    }
    if (needs.length > 0) setAllConfirm(needs);
    setRepairing(false);
  }, [report, onRepair]);

  const confirmAll = useCallback(async () => {
    if (!allConfirm) return;
    setRepairing(true);
    await Promise.all(allConfirm.map((c) => onRepair(c.repairId, true)));
    setAllConfirm(null);
    setRepairing(false);
  }, [allConfirm, onRepair]);

  const grouped = report ? groupByCategory(report) : [];

  return (
    <div className="w-full rounded-xl border bg-background shadow-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Stethoscope className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Doctor 报告</span>
          {report && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="flex items-center gap-0.5 text-green-600"><CheckCircle2 className="size-3.5" />{report.summary.ok}</span>
              <span className="flex items-center gap-0.5 text-yellow-600"><AlertTriangle className="size-3.5" />{report.summary.warn}</span>
              <span className="flex items-center gap-0.5 text-red-600"><XCircle className="size-3.5" />{report.summary.error}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {report && report.checks.some((c) => c.fixHint) && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={runAll} disabled={repairing || loading}>
              <Wrench className="size-3.5" />
              修复全部
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose} aria-label="关闭">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="max-h-[50vh] overflow-y-auto p-3 space-y-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在诊断…
          </div>
        )}
        {!loading && error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">诊断失败：{error}</div>
        )}
        {!loading && !error && grouped.length === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">无诊断结果</div>
        )}
        {!loading && !error && grouped.map(([category, checks]) => (
          <div key={category}>
            <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">
              {CATEGORY_LABELS[category] ?? category}
            </div>
            <div className="space-y-1">
              {checks.map((check) => {
                const { Icon, className } = STATUS_ICON[check.status];
                return (
                  <div key={check.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm">
                    <Icon className={cn('mt-0.5 size-4 shrink-0', className)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{check.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{check.message}</div>
                    </div>
                    {check.fixHint && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 shrink-0 text-xs"
                        disabled={repairing}
                        onClick={() => runRepair(check.fixHint!, false)}
                      >
                        修复
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {pendingConfirm && !allConfirm && (
        <div className="border-t bg-yellow-50 px-4 py-2.5">
          <div className="text-xs text-yellow-800">{pendingConfirm.message}</div>
          <div className="mt-1.5 flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" disabled={repairing} onClick={() => runRepair(pendingConfirm.repairId, true)}>
              确认修复
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={repairing} onClick={() => setPendingConfirm(null)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {allConfirm && (
        <div className="border-t bg-yellow-50 px-4 py-2.5">
          <div className="text-xs text-yellow-800">
            {allConfirm.length} 个破坏性修复需确认：{allConfirm.map((c) => c.repairId).join('、')}
          </div>
          <div className="mt-1.5 flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" disabled={repairing} onClick={confirmAll}>
              全部确认
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={repairing} onClick={() => setAllConfirm(null)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function groupByCategory(report: DoctorReport): Array<[DoctorReport['checks'][number]['category'], DoctorReport['checks']]> {
  const groups = new Map<DoctorReport['checks'][number]['category'], DoctorReport['checks']>();
  for (const check of report.checks) {
    const list = groups.get(check.category);
    if (list) list.push(check);
    else groups.set(check.category, [check]);
  }
  return [...groups.entries()];
}
