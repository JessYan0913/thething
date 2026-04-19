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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface ApprovalPanelProps {
  isOpen: boolean;
  approvalId: string;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  onApprove: (approvalId: string, options?: { alwaysAllow?: boolean }) => void;
  onDeny: (approvalId: string, reason?: string) => void;
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

export function ApprovalPanel({
  isOpen,
  approvalId,
  toolCallId: _toolCallId,
  toolName,
  toolInput,
  onApprove,
  onDeny,
}: ApprovalPanelProps) {
  const [alwaysAllow, setAlwaysAllow] = React.useState(false);

  if (!isOpen) return null;

  const config = getToolConfig(toolName);
  const Icon = config.icon;
  const name = toolName.replace('tool-', '').replace(/_/g, ' ');
  const summary = getSummary(name, toolInput, config.label);

  const handleApprove = () => {
    onApprove(approvalId, { alwaysAllow });
  };

  const handleDeny = () => {
    onDeny(approvalId, '用户拒绝此操作');
  };

  return (
    <div className='shrink-0 bg-background/95 backdrop-blur'>
      <div className='px-4 py-3'>
        {/* 标题行 */}
        <div className='flex items-center justify-between gap-2 mb-3'>
          <div className='flex items-center gap-2'>
            <Icon className='size-4 text-blue-500' />
            <span className='text-sm font-medium'>{config.label}</span>
          </div>
          <button
            className='shrink-0 h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors'
            onClick={handleDeny}
          >
            <XIcon className='size-3' />
          </button>
        </div>

        {/* 操作摘要 */}
        <div className='rounded-md bg-muted/50 px-3 py-1.5 mb-3'>
          <code className='text-xs font-mono break-all'>{summary}</code>
        </div>

        {/* Always allow 复选框 */}
        <div className='flex items-center gap-2 mb-3'>
          <Checkbox
            id='always-allow'
            checked={alwaysAllow}
            onCheckedChange={(checked) => setAlwaysAllow(checked === true)}
          />
          <label
            htmlFor='always-allow'
            className='text-xs text-muted-foreground cursor-pointer select-none'
          >
            以后自动允许此操作
          </label>
        </div>

        {/* 操作按钮 */}
        <div className='flex items-center justify-between gap-2'>
          <Button
            variant='ghost'
            size='sm'
            className='h-7'
            onClick={handleDeny}
          >
            <XIcon className='size-3 mr-1' />
            拒绝
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='h-7'
            onClick={handleApprove}
          >
            <CheckCircleIcon className='size-3 mr-1' />
            执行
          </Button>
        </div>
      </div>
    </div>
  );
}