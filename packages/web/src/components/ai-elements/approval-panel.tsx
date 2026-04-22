'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCircleIcon,
  TerminalIcon,
  FileIcon,
  SearchIcon,
  EditIcon,
  WrenchIcon,
  XIcon,
  CheckSquareIcon,
  SquareIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

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

const TOOL_CONFIGS: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  bash: { icon: TerminalIcon, label: '执行命令' },
  write_file: { icon: FileIcon, label: '写入文件' },
  edit_file: { icon: EditIcon, label: '编辑文件' },
  read_file: { icon: FileIcon, label: '读取文件' },
  glob: { icon: SearchIcon, label: '搜索文件' },
  grep: { icon: SearchIcon, label: '搜索内容' },
  web_search: { icon: SearchIcon, label: '网络搜索' },
};

function getToolConfig(toolName: string) {
  const name = toolName.replace('tool-', '').replace(/_/g, ' ');
  return TOOL_CONFIGS[name] || { icon: WrenchIcon, label: name || '工具调用' };
}

function getSummary(name: string, toolInput: Record<string, unknown>, label: string): string {
  if (name === 'bash') {
    const cmd = String(toolInput.command || '');
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  if (name === 'write file' || name === 'edit file') {
    return String(toolInput.filePath || '未知文件');
  }
  if (name === 'read file') {
    return String(toolInput.file_path || toolInput.filePath || '未知文件');
  }
  if (name === 'glob' || name === 'grep') {
    return String(toolInput.pattern || '搜索');
  }
  return label;
}

function ApprovalItem({
  request,
  isSelected,
  onToggleSelect,
  onApprove,
  onDeny,
}: {
  request: ApprovalRequest;
  isSelected: boolean;
  onToggleSelect: () => void;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}) {
  const config = getToolConfig(request.toolName);
  const Icon = config.icon;
  const name = request.toolName.replace('tool-', '').replace(/_/g, ' ');
  const summary = getSummary(name, request.toolInput, config.label);

  return (
    <div className='flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors'>
      <button
        onClick={onToggleSelect}
        className='shrink-0 h-5 w-5 flex items-center justify-center'
      >
        {isSelected ? (
          <CheckSquareIcon className='size-4 text-blue-500' />
        ) : (
          <SquareIcon className='size-4 text-muted-foreground' />
        )}
      </button>
      <Icon className='size-3.5 shrink-0 text-muted-foreground' />
      <span className='text-xs text-muted-foreground'>{config.label}:</span>
      <code className='text-xs font-mono truncate flex-1'>{summary}</code>
      <div className='shrink-0 flex items-center gap-1'>
        <button
          className='h-5 px-1.5 text-xs text-muted-foreground hover:text-red-500 transition-colors'
          onClick={() => onDeny(request.approvalId)}
        >
          <XIcon className='size-3' />
        </button>
        <button
          className='h-5 px-1.5 text-xs text-muted-foreground hover:text-green-500 transition-colors'
          onClick={() => onApprove(request.approvalId)}
        >
          <CheckCircleIcon className='size-3' />
        </button>
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
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [alwaysAllow, setAlwaysAllow] = React.useState(false);

  if (!isOpen || requests.length === 0) return null;

  // 默认全选 - 当请求列表变化时重置为全选
  React.useEffect(() => {
    setSelectedIds(new Set(requests.map(r => r.approvalId)));
  }, [requests]);

  const toggleSelect = (approvalId: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(approvalId)) {
      newSet.delete(approvalId);
    } else {
      newSet.add(approvalId);
    }
    setSelectedIds(newSet);
  };

  const selectedRequests = requests.filter(r => selectedIds.has(r.approvalId));

  const handleApproveSelected = () => {
    if (selectedRequests.length === requests.length) {
      // 全选时批量确认
      onApproveAll(selectedRequests, { alwaysAllow });
    } else {
      // 逐个确认选中的
      for (const req of selectedRequests) {
        onApprove(req.approvalId, { alwaysAllow });
      }
    }
  };

  const handleDenyAll = () => {
    onDenyAll(requests, '用户拒绝所有操作');
  };

  const handleApproveSingle = (approvalId: string) => {
    onApprove(approvalId, { alwaysAllow });
  };

  const handleDenySingle = (approvalId: string) => {
    onDeny(approvalId, '用户拒绝此操作');
  };

  return (
    <div className='shrink-0 bg-background/95 backdrop-blur border-t'>
      <div className='px-4 py-3'>
        {/* 标题行 */}
        <div className='flex items-center justify-between gap-2 mb-2'>
          <div className='flex items-center gap-2'>
            <WrenchIcon className='size-4 text-blue-500' />
            <span className='text-sm font-medium'>
              待审批操作 ({requests.length})
            </span>
          </div>
          <button
            className='shrink-0 h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors'
            onClick={handleDenyAll}
          >
            <XIcon className='size-3' />
          </button>
        </div>

        {/* 操作列表 */}
        <div className='max-h-48 overflow-y-auto mb-3 rounded-md bg-muted/30 py-1'>
          {requests.map((request) => (
            <ApprovalItem
              key={request.approvalId}
              request={request}
              isSelected={selectedIds.has(request.approvalId)}
              onToggleSelect={() => toggleSelect(request.approvalId)}
              onApprove={handleApproveSingle}
              onDeny={handleDenySingle}
            />
          ))}
        </div>

        {/* Always allow 复选框 */}
        <div className='flex items-center gap-2 mb-3'>
          <Checkbox
            id='always-allow-batch'
            checked={alwaysAllow}
            onCheckedChange={(checked) => setAlwaysAllow(checked === true)}
          />
          <label
            htmlFor='always-allow-batch'
            className='text-xs text-muted-foreground cursor-pointer select-none'
          >
            以后自动允许此类操作
          </label>
        </div>

        {/* 批量操作按钮 */}
        <div className='flex items-center justify-between gap-2'>
          <Button
            variant='ghost'
            size='sm'
            className='h-7'
            onClick={handleDenyAll}
          >
            <XIcon className='size-3 mr-1' />
            全部拒绝
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='h-7'
            onClick={handleApproveSelected}
            disabled={selectedRequests.length === 0}
          >
            <CheckCircleIcon className='size-3 mr-1' />
            执行选中 ({selectedRequests.length})
          </Button>
        </div>
      </div>
    </div>
  );
}