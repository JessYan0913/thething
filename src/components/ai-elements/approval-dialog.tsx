'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/ai-elements/code-block';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  TerminalIcon,
  FileIcon,
  SearchIcon,
  EditIcon,
  WrenchIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApprovalDialogProps {
  isOpen: boolean;
  approvalId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string, reason?: string) => void;
}

const TOOL_CONFIGS: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  bash: { icon: TerminalIcon, label: '执行命令' },
  write_file: { icon: FileIcon, label: '写入文件' },
  edit_file: { icon: EditIcon, label: '编辑文件' },
  read_file: { icon: FileIcon, label: '读取文件' },
  glob: { icon: SearchIcon, label: '搜索文件' },
  grep: { icon: SearchIcon, label: '搜索内容' },
};

function getToolConfig(toolName: string) {
  return TOOL_CONFIGS[toolName] || { icon: WrenchIcon, label: '工具调用' };
}

function getRiskLevel(toolName: string, input: Record<string, unknown>): 'low' | 'medium' | 'high' {
  // Bash 命令风险评估
  if (toolName === 'bash') {
    const command = String(input.command || '');
    if (/rm|delete|drop|truncate|format/i.test(command)) return 'high';
    if (/install|npm|pnpm|yarn add|pip/i.test(command)) return 'medium';
    return 'low';
  }

  // 文件操作风险评估
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const filePath = String(input.filePath || '');
    if (/\.env|\.secret|\.key|\.pem|config/i.test(filePath)) return 'high';
    if (/src\//i.test(filePath)) return 'medium';
    return 'low';
  }

  return 'low';
}

const RISK_STYLES: Record<'low' | 'medium' | 'high', { badgeClass: string; iconColor: string }> = {
  low: { badgeClass: 'bg-green-100 text-green-700 border-green-200', iconColor: 'text-green-600' },
  medium: { badgeClass: 'bg-yellow-100 text-yellow-700 border-yellow-200', iconColor: 'text-yellow-600' },
  high: { badgeClass: 'bg-red-100 text-red-700 border-red-200', iconColor: 'text-red-600' },
};

export function ApprovalDialog({
  isOpen,
  approvalId,
  toolName,
  toolInput,
  onApprove,
  onDeny,
}: ApprovalDialogProps) {
  const config = getToolConfig(toolName);
  const riskLevel = getRiskLevel(toolName, toolInput);
  const riskStyle = RISK_STYLES[riskLevel];
  const Icon = config.icon;

  const handleApprove = () => {
    onApprove(approvalId);
  };

  const handleDeny = () => {
    onDeny(approvalId, '用户拒绝此操作');
  };

  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-5" />
            需要您的确认
          </DialogTitle>
          <DialogDescription>
            Agent 正在请求执行以下操作，请确认是否允许。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 工具信息 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{config.label}</Badge>
              <span className="font-mono text-sm text-muted-foreground">{toolName}</span>
            </div>
            <Badge className={cn('border', riskStyle.badgeClass)}>
              {riskLevel === 'high' && <AlertTriangleIcon className="size-3 mr-1" />}
              {riskLevel === 'low' && <CheckCircleIcon className={cn('size-3 mr-1', riskStyle.iconColor)} />}
              {riskLevel === 'high' ? '高风险' : riskLevel === 'medium' ? '中风险' : '低风险'}
            </Badge>
          </div>

          {/* 工具输入参数 */}
          <div className="rounded-md border bg-muted/30 p-3">
            <h4 className="mb-2 font-medium text-xs text-muted-foreground uppercase tracking-wide">
              参数详情
            </h4>
            <CodeBlock
              code={JSON.stringify(toolInput, null, 2)}
              language="json"
              className="text-xs max-h-[200px] overflow-auto"
            />
          </div>

          {/* 风险提示 */}
          {riskLevel === 'high' && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangleIcon className="size-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">此操作具有较高的风险</p>
                <p className="text-red-600">请仔细检查参数后再决定是否批准。</p>
              </div>
            </div>
          )}

          {/* Bash 命令特殊展示 */}
          {toolName === 'bash' && toolInput.command && (
            <div className="rounded-md border bg-slate-900 p-3">
              <h4 className="mb-2 font-medium text-xs text-slate-400 uppercase tracking-wide">
                命令
              </h4>
              <pre className="font-mono text-sm text-green-400 overflow-x-auto">
                {String(toolInput.command)}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleDeny}
            className="flex items-center gap-2"
          >
            <AlertTriangleIcon className="size-4" />
            拒绝
          </Button>
          <Button
            onClick={handleApprove}
            className="flex items-center gap-2"
          >
            <CheckCircleIcon className="size-4" />
            批准执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}