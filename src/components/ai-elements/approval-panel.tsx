'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  TerminalIcon,
  FileIcon,
  SearchIcon,
  EditIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';
import {
  Confirmation,
  ConfirmationRequest,
  ConfirmationActions,
  ConfirmationAction,
  type ApprovalState,
  type ApprovalInfo,
} from '@/components/ai-elements/confirmation';

interface ApprovalPanelProps {
  isOpen: boolean;
  approvalId: string;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  onApprove: (approvalId: string) => void;
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

function getRiskLevel(
  toolName: string,
  input: Record<string, unknown>
): 'low' | 'medium' | 'high' {
  const name = toolName.replace('tool-', '').replace(/_/g, ' ');

  if (name === 'bash') {
    const command = String(input.command || '');
    if (/rm|delete|drop|truncate|format/i.test(command)) return 'high';
    if (/install|npm|pnpm|yarn add|pip/i.test(command)) return 'medium';
    return 'low';
  }

  if (name === 'write file' || name === 'edit file') {
    const filePath = String(input.filePath || '');
    if (/\.env|\.secret|\.key|\.pem|config/i.test(filePath)) return 'high';
    if (/src\//i.test(filePath)) return 'medium';
    return 'low';
  }

  return 'low';
}

const RISK_CONFIG: Record<
  'low' | 'medium' | 'high',
  { color: string; text: string }
> = {
  low: { color: 'text-green-600', text: '低风险' },
  medium: { color: 'text-yellow-600', text: '中风险' },
  high: { color: 'text-red-600', text: '高风险' },
};

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
  if (!isOpen) return null;

  const config = getToolConfig(toolName);
  const riskLevel = getRiskLevel(toolName, toolInput);
  const riskConfig = RISK_CONFIG[riskLevel];
  const Icon = config.icon;
  const name = toolName.replace('tool-', '').replace(/_/g, ' ');

  const summary = getSummary(name, toolInput, config.label);

  const approval: ApprovalInfo = { id: approvalId };
  const state: ApprovalState = 'approval-requested';

  const handleApprove = () => {
    onApprove(approvalId);
  };

  const handleDeny = () => {
    onDeny(approvalId, '用户拒绝此操作');
  };

  return (
    <div className='shrink-0 border-b bg-background/95 backdrop-blur'>
      <div className='px-3 py-3'>
        {/* 标题行 */}
        <div className='flex items-center gap-2 mb-2'>
          <Icon
            className={cn(
              'size-4',
              riskLevel === 'high' ? 'text-red-500' : 'text-blue-500'
            )}
          />
          <span className='text-sm font-medium'>{config.label}</span>
          <span className={cn('text-xs', riskConfig.color)}>
            {riskLevel !== 'low' && (
              <AlertTriangleIcon className='size-3 inline mr-1' />
            )}
            {riskConfig.text}
          </span>
          <button
            className='ml-auto h-6 px-2 text-muted-foreground hover:text-foreground transition-colors'
            onClick={handleDeny}
          >
            <XIcon className='size-3' />
          </button>
        </div>

        {/* 操作摘要 */}
        <div className='rounded-md bg-muted/50 px-2 py-1.5 mb-3'>
          <code className='text-xs font-mono break-all'>{summary}</code>
        </div>

        {/* 操作按钮 */}
        <Confirmation
          approval={approval}
          state={state}
          toolName={toolName}
          toolInput={toolInput}
          className='bg-transparent border-0 p-0'
        >
          <ConfirmationRequest>
            <ConfirmationActions className='w-full justify-between'>
              <ConfirmationAction
                variant='outline'
                onClick={handleDeny}
              >
                <XIcon className='size-3 mr-1' />
                拒绝
              </ConfirmationAction>
              <ConfirmationAction onClick={handleApprove}>
                <CheckCircleIcon className='size-3 mr-1' />
                执行
              </ConfirmationAction>
            </ConfirmationActions>
          </ConfirmationRequest>
        </Confirmation>
      </div>
    </div>
  );
}