'use client';

import * as React from 'react';
import { CheckCircleIcon, ClipboardListIcon, XCircleIcon, AlertCircleIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface PlanReviewItem {
  subject: string;
  verify?: string;
}

export interface PlanReviewRequest {
  approvalId: string;
  toolCallId: string;
  todos: PlanReviewItem[];
}

interface PlanReviewPanelProps {
  isOpen: boolean;
  plan: PlanReviewRequest | null;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string, reason?: string) => void;
}

/**
 * 计划确认卡：展示模型提交的完整计划（任务 + 完成标准），
 * 用户批准后落 todo 并继续执行，或附理由拒绝让模型修订。
 */
export function PlanReviewPanel({
  isOpen,
  plan,
  onApprove,
  onReject,
}: PlanReviewPanelProps) {
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');

  // 切换新计划时重置拒绝态
  React.useEffect(() => {
    setRejecting(false);
    setReason('');
  }, [plan?.approvalId]);

  if (!isOpen || !plan) return null;

  const handleApprove = () => {
    onApprove(plan.approvalId);
  };

  const handleReject = () => {
    if (rejecting) {
      onReject(plan.approvalId, reason.trim() || undefined);
    } else {
      setRejecting(true);
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="flex items-start gap-3 p-3 pb-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-indigo-600/10 text-indigo-600 dark:text-indigo-400">
          <ClipboardListIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] uppercase tracking-wider">
              计划确认
            </Badge>
            <span className="text-xs text-muted-foreground">
              {plan.todos.length} 个任务 · 批准后开始执行
            </span>
          </div>
        </div>
      </div>

      {/* 任务清单 */}
      <div className="px-3 pb-2 space-y-1.5 max-h-56 overflow-y-auto">
        {plan.todos.map((item, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm"
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-indigo-600/10 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-foreground/90 leading-snug">{item.subject}</div>
              {item.verify && (
                <div className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                  <AlertCircleIcon className="mt-0.5 size-3 shrink-0" />
                  <code className="font-mono">{item.verify}</code>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 拒绝理由 */}
      {rejecting && (
        <div className="px-3 pb-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="告诉 Agent 哪里需要调整（可选）..."
            className="min-h-[64px] text-sm"
            autoFocus
          />
        </div>
      )}

      {/* 操作区 */}
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-7 px-2 text-xs text-muted-foreground hover:text-red-600 hover:border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20',
            rejecting && 'border-red-200 text-red-600 hover:bg-red-50 dark:bg-red-950/20'
          )}
          onClick={handleReject}
        >
          <XCircleIcon className="size-3.5 mr-1" />
          {rejecting ? '确认拒绝' : '拒绝'}
        </Button>
        {rejecting && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setRejecting(false)}
          >
            返回
          </Button>
        )}
        <Button
          size="sm"
          className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={handleApprove}
        >
          <CheckCircleIcon className="size-3.5 mr-1" />
          批准计划
        </Button>
      </div>
    </div>
  );
}
