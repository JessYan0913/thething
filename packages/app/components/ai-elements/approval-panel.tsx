'use client';

import * as React from 'react';
import {
  CheckCircleIcon,
  TerminalIcon,
  FileIcon,
  SearchIcon,
  EditIcon,
  WrenchIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface ApprovalRequest {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

interface ApprovalPanelProps {
  isOpen: boolean;
  requests: ApprovalRequest[];
  onApprove: (approvalId: string, options?: { alwaysAllow?: boolean }) => void;
  onApproveAll: (requests: ApprovalRequest[], options?: { alwaysAllow?: boolean }) => void;
  onDeny: (approvalId: string, reason?: string) => void;
  onDenyAll: (requests: ApprovalRequest[], reason?: string) => void;
}

const TOOL_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string; color: string }
> = {
  bash:       { icon: TerminalIcon,  label: '命令',    color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30' },
  write_file: { icon: FileIcon,      label: '写入文件', color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30' },
  edit_file:  { icon: EditIcon,      label: '编辑文件', color: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/30' },
  read_file:  { icon: FileIcon,      label: '读取文件', color: 'text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/30' },
  glob:       { icon: SearchIcon,    label: '搜索文件', color: 'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/30' },
  grep:       { icon: SearchIcon,    label: '搜索内容', color: 'text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-950/30' },
  web_fetch:  { icon: SearchIcon,    label: '网络搜索', color: 'text-cyan-600 bg-cyan-50 dark:text-cyan-400 dark:bg-cyan-950/30' },
};

function getToolMeta(toolName: string) {
  const name = toolName.replace('tool-', '').replace(/_/g, ' ').toLowerCase();
  return TOOL_META[name] || { icon: WrenchIcon, label: name || '工具', color: 'text-gray-600 bg-gray-50 dark:text-gray-400 dark:bg-gray-950/30' };
}

function getSummary(name: string, toolInput: Record<string, unknown>): string {
  if (name === 'bash') {
    return String(toolInput.command || '');
  }
  if (name === 'edit_file' || name === 'write_file') {
    return String(toolInput.filePath || toolInput.path || '');
  }
  if (name === 'read_file') {
    return String(toolInput.file_path || toolInput.filePath || '');
  }
  if (name === 'glob' || name === 'grep') {
    return String(toolInput.pattern || '');
  }
  if (toolInput.command) return String(toolInput.command);
  if (toolInput.filePath) return String(toolInput.filePath);
  if (toolInput.path) return String(toolInput.path);
  if (toolInput.query) return String(toolInput.query);
  if (toolInput.url) return String(toolInput.url);
  return '';
}

function getAlwaysAllowLabel(requests: ApprovalRequest[]): string {
  if (requests.length === 0) return '以后自动允许此类操作';

  const toolNames = new Set(
    requests.map(r => r.toolName.replace('tool-', '').replace(/ /g, '_').toLowerCase()),
  );

  if (toolNames.size > 1) return '以后自动允许这些类型的操作';

  const toolName = [...toolNames][0];
  if (toolName === 'bash') {
    const prefix = String(requests[0].toolInput.command || '').trim().split(' ')[0];
    if (prefix) return `以后自动允许 ${prefix} 命令`;
  }

  return `以后自动允许${getToolMeta(toolName).label}`;
}

function ApprovalItemCard({
  request,
  onApprove,
  onDeny,
}: {
  request: ApprovalRequest;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const meta = getToolMeta(request.toolName);
  const Icon = meta.icon;
  const name = request.toolName.replace('tool-', '').replace(/_/g, ' ').toLowerCase();
  const summary = getSummary(name, request.toolInput);

  return (
    <div className="rounded-lg border bg-card transition-colors hover:border-primary/20">
      {/* Main row */}
      <div className="flex items-start gap-3 p-3">
        {/* Tool badge */}
        <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', meta.color)}>
          <Icon className="size-4" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] uppercase tracking-wider">
              {meta.label}
            </Badge>
          </div>
          {summary ? (
            <div className="flex items-start gap-1">
              <code className="block w-full truncate text-xs font-mono text-foreground/80 leading-relaxed">
                {summary}
              </code>
              {summary.length > 60 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="shrink-0 mt-px text-muted-foreground hover:text-foreground transition-colors"
                >
                  {expanded
                    ? <ChevronDownIcon className="size-3" />
                    : <ChevronRightIcon className="size-3" />
                  }
                </button>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">(无参数)</span>
          )}
          {/* Expanded detail */}
          {expanded && summary.length > 60 && (
            <pre className="mt-2 p-2 rounded bg-muted/50 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {summary}
            </pre>
          )}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-red-600 hover:border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={() => onDeny(request.approvalId)}
          >
            <XCircleIcon className="size-3.5 mr-1" />
            拒绝
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
            onClick={() => onApprove(request.approvalId)}
          >
            <CheckCircleIcon className="size-3.5 mr-1" />
            批准
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ApprovalPanel({
  isOpen,
  requests,
  onApprove,
  onApproveAll,
  onDeny,
  onDenyAll,
}: ApprovalPanelProps) {
  const [alwaysAllow, setAlwaysAllow] = React.useState(false);

  if (!isOpen || requests.length === 0) return null;

  const handleApproveSingle = (approvalId: string) => {
    onApprove(approvalId, { alwaysAllow });
  };

  const handleDenySingle = (approvalId: string) => {
    onDeny(approvalId, '用户拒绝此操作');
  };

  const handleApproveAll = () => {
    onApproveAll(requests, { alwaysAllow });
  };

  const handleDenyAll = () => {
    onDenyAll(requests, '用户拒绝所有操作');
  };

  return (
    <div className="shrink-0 bg-background/95 backdrop-blur">
      <div className="px-4 py-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/30">
              <WrenchIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-sm font-semibold">待审批操作</span>
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-medium tabular-nums">
              {requests.length}
            </Badge>
          </div>
          <button
            className="size-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
            onClick={handleDenyAll}
            title="全部拒绝"
          >
            <XCircleIcon className="size-3.5" />
          </button>
        </div>

        {/* Item list */}
        <div className="space-y-2 max-h-[320px] overflow-y-auto">
          {requests.map((request) => (
            <ApprovalItemCard
              key={request.approvalId}
              request={request}
              onApprove={handleApproveSingle}
              onDeny={handleDenySingle}
            />
          ))}
        </div>

        {/* Always allow */}
        <div className="flex items-center gap-2.5">
          <Switch
            id="always-allow-batch"
            checked={alwaysAllow}
            onCheckedChange={setAlwaysAllow}
          />
          <label
            htmlFor="always-allow-batch"
            className="text-xs text-muted-foreground cursor-pointer select-none leading-tight"
          >
            {getAlwaysAllowLabel(requests)}
          </label>
        </div>

        <Separator />

        {/* Batch actions */}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={handleDenyAll}
          >
            <XCircleIcon className="size-3.5 mr-1" />
            全部拒绝
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-8 text-xs"
            onClick={handleApproveAll}
          >
            <CheckCircleIcon className="size-3.5 mr-1" />
            全部批准
          </Button>
        </div>
      </div>
    </div>
  );
}
