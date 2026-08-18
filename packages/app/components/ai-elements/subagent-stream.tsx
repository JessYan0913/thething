'use client';

import { useControllableState } from '@radix-ui/react-use-controllable-state';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  Loader2Icon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';

import { Shimmer } from './shimmer';

export interface SubDataPart {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
}

const streamdownPlugins = { cjk, code, math, mermaid };
const AUTO_CLOSE_DELAY = 1000;

// ============================================================
// 事件解析
// ============================================================

interface AgentStep {
  seq: number;
  name: string;
  result?: string;
}

interface AgentRun {
  agentType?: string;
  task?: string;
  steps: AgentStep[];
  text: string;
  done?: {
    success: boolean;
    durationMs?: number;
    stepsExecuted?: number;
    status?: string;
    error?: string;
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    /** parallel 模式的完成事件字段 */
    taskCount?: number;
    successCount?: number;
  };
  error?: string;
  progress?: string;
}

/**
 * 把属于某个 rootId 的 data-sub 事件解析为一次 agent 运行的结构化视图。
 * 事件 id 约定：
 * - `${rootId}`：open / text-delta / done / error / progress
 * - `${rootId}#${seq}`：tool-call / tool-result（同 seq 配对）
 */
function parseAgentRun(parts: SubDataPart[], rootId: string): AgentRun {
  const run: AgentRun = { steps: [], text: '' };
  const stepMap = new Map<number, AgentStep>();

  for (const p of parts) {
    const d = p.data ?? {};
    if (p.id === rootId) {
      switch (p.type) {
        case 'data-sub-open':
          run.agentType = d.agentType as string | undefined;
          run.task = d.task as string | undefined;
          break;
        case 'data-sub-text-delta':
          run.text = (d.accumulated as string | undefined) ?? '';
          break;
        case 'data-sub-done':
          run.done = d as AgentRun['done'];
          break;
        case 'data-sub-error':
          run.error = d.error as string | undefined;
          break;
        case 'data-sub-progress':
          run.progress = d.message as string | undefined;
          break;
      }
      continue;
    }
    // step 事件：`${rootId}#${seq}`
    if (p.id?.startsWith(`${rootId}#`)) {
      const seq = (d.seq as number | undefined) ?? Number(p.id.slice(rootId.length + 1));
      if (!Number.isFinite(seq)) continue;
      const step = stepMap.get(seq) ?? { seq, name: (d.name as string) ?? 'tool' };
      if (p.type === 'data-sub-tool-call') {
        step.name = (d.name as string) ?? step.name;
      } else if (p.type === 'data-sub-tool-result') {
        step.result = (d.result as string) ?? '';
      }
      stepMap.set(seq, step);
    }
  }

  run.steps = [...stepMap.values()].sort((a, b) => a.seq - b.seq);
  return run;
}

/** 并行模式：按 `${rootId}-${index}` 前缀把事件分给各子任务 */
function groupParallelChildren(
  parts: SubDataPart[],
  rootId: string,
  tasks: Array<{ label: string; agentType: string; task: string }>,
): Array<{ label: string; run: AgentRun }> {
  return tasks.map((t, i) => {
    const childId = `${rootId}-${i}`;
    const childParts = parts.filter(
      (p) => p.id === childId || p.id?.startsWith(`${childId}#`),
    );
    const run = parseAgentRun(childParts, childId);
    run.agentType ??= t.agentType;
    run.task ??= t.task;
    return { label: t.label, run };
  });
}

// ============================================================
// 子组件
// ============================================================

function TokenBar({ input, output, total }: { input: number; output: number; total: number }) {
  if (!total) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
      <span>Tokens: {total.toLocaleString()}</span>
      <span className="text-muted-foreground/50">|</span>
      <span>In: {input.toLocaleString()}</span>
      <span className="text-muted-foreground/50">|</span>
      <span>Out: {output.toLocaleString()}</span>
    </div>
  );
}

function StepList({ steps }: { steps: AgentStep[] }) {
  const [isOpen, setIsOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <WrenchIcon className="size-3 shrink-0" />
        <span className="font-medium">{steps.length} 次工具调用</span>
        <ChevronDownIcon
          className={cn('ml-auto size-3 shrink-0 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto pr-1">
          {steps.map((step) => (
            <div key={step.seq} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              {step.result !== undefined ? (
                <CheckIcon className="mt-0.5 size-3 shrink-0 text-green-600" />
              ) : (
                <Loader2Icon className="mt-0.5 size-3 shrink-0 animate-spin text-blue-500" />
              )}
              <WrenchIcon className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0">
                <span className="font-medium">{step.name}</span>
                {step.result !== undefined && step.result !== '' && (
                  <span className="text-muted-foreground/60"> — {step.result.slice(0, 80)}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 单次 agent 运行的时间线主体（步骤 + 流式文本 + 错误/token 统计） */
function RunTimeline({ run, isRunning }: { run: AgentRun; isRunning: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 流式时文本持续增长，自动滚到底部保持最新输出可见
  useEffect(() => {
    if (isRunning && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isRunning, run.text]);

  const tokenUsage = run.done?.tokenUsage;

  return (
    <div className="space-y-3">
      <StepList steps={run.steps} />
      {run.progress && isRunning && (
        <p className="text-xs text-muted-foreground/70 italic">{run.progress}</p>
      )}
      {run.text && (
        <div
          ref={scrollRef}
          className="max-h-64 overflow-y-auto rounded-md border border-muted/50 bg-muted/30 p-2 text-sm text-muted-foreground/90"
        >
          <Streamdown plugins={streamdownPlugins}>{run.text}</Streamdown>
        </div>
      )}
      {(run.error ?? run.done?.error) && (
        <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <CircleAlertIcon className="mt-0.5 size-3 shrink-0" />
          {run.error ?? run.done?.error}
        </div>
      )}
      {tokenUsage && (
        <TokenBar
          input={tokenUsage.inputTokens ?? 0}
          output={tokenUsage.outputTokens ?? 0}
          total={tokenUsage.totalTokens ?? 0}
        />
      )}
    </div>
  );
}

/** header 右侧状态：运行中显示当前动作，结束后显示步数/时长 */
function RunStatus({ run, isRunning }: { run: AgentRun; isRunning: boolean }) {
  if (isRunning) {
    const current = [...run.steps].reverse().find((s) => s.result === undefined);
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin text-blue-500" />
        {current ? current.name : run.steps.length > 0 ? `${run.steps.length} steps` : 'starting'}
      </span>
    );
  }
  const failed = run.done && (!run.done.success || run.done.status === 'failed');
  const aborted = run.done?.status === 'aborted';
  if (failed || run.error) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-red-600">
        <XCircleIcon className="size-3" /> failed
      </span>
    );
  }
  if (aborted) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-orange-500">
        <XCircleIcon className="size-3" /> aborted
      </span>
    );
  }
  const steps = run.done?.stepsExecuted ?? run.steps.length;
  const secs = run.done?.durationMs != null ? (run.done.durationMs / 1000).toFixed(1) : null;
  // parallel 模式的 done 事件没有 stepsExecuted，显示任务完成数
  const label =
    run.done?.taskCount != null
      ? `${run.done.successCount ?? 0}/${run.done.taskCount} tasks`
      : `${steps} steps`;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <CheckIcon className="size-3 text-green-600" />
      {label}{secs ? ` · ${secs}s` : ''}
    </span>
  );
}

// ============================================================
// SubAgentCard
// ============================================================

export interface SubAgentCardProps {
  /** 该工具调用关联的全部 data-sub parts（含并行子任务事件） */
  parts: SubDataPart[];
  /** 宿主 agent 工具调用的 toolCallId（事件 rootId） */
  toolCallId: string;
  className?: string;
}

/**
 * 子 Agent 过程卡片：运行时自动展开实时显示步骤与流式文本，
 * 结束后自动收起为一行摘要，可手动点开回看（交互模式同 Reasoning 组件）。
 */
export function SubAgentCard({ parts, toolCallId, className }: SubAgentCardProps) {
  const openPart = parts.find((p) => p.type === 'data-sub-open' && p.id === toolCallId);
  const openData = openPart?.data ?? {};
  const isParallel = openData.mode === 'parallel';

  const donePart = parts.find((p) => p.type === 'data-sub-done' && p.id === toolCallId);
  const isRunning = !donePart;

  // ── 自动展开/收起（同 reasoning.tsx 行为）──
  const [isOpen, setIsOpen] = useControllableState<boolean>({ defaultProp: isRunning });
  const hasEverRunRef = useRef(isRunning);
  const [hasAutoClosed, setHasAutoClosed] = useState(false);

  useEffect(() => {
    if (isRunning) {
      hasEverRunRef.current = true;
      if (!isOpen && !hasAutoClosed) setIsOpen(true);
    }
  }, [isRunning, isOpen, hasAutoClosed, setIsOpen]);

  useEffect(() => {
    if (hasEverRunRef.current && !isRunning && isOpen && !hasAutoClosed) {
      const timer = setTimeout(() => {
        setIsOpen(false);
        setHasAutoClosed(true);
      }, AUTO_CLOSE_DELAY);
      return () => clearTimeout(timer);
    }
  }, [isRunning, isOpen, hasAutoClosed, setIsOpen]);

  // ── 解析运行数据 ──
  const run = parseAgentRun(parts, toolCallId);
  const parallelTasks = isParallel
    ? (openData.tasks as Array<{ label: string; agentType: string; task: string }> | undefined) ?? []
    : [];
  const children = isParallel ? groupParallelChildren(parts, toolCallId, parallelTasks) : [];

  const title = isParallel
    ? `Parallel: ${parallelTasks.length} tasks`
    : `${run.agentType ?? 'agent'}: ${(run.task ?? '').slice(0, 60)}`;

  return (
    <Collapsible
      className={cn('not-prose group my-2', className)}
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <BotIcon className="size-4 shrink-0" />
        {isRunning ? (
          <Shimmer className="truncate text-sm" duration={1.5} spread={1}>
            {title}
          </Shimmer>
        ) : (
          <span className="truncate">{title}</span>
        )}
        <RunStatus run={run} isRunning={isRunning} />
        <ChevronDownIcon
          className={cn('ml-auto size-4 shrink-0 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in">
        <div className="mt-2 space-y-3 border-l-2 border-muted pl-4">
          {isParallel ? (
            children.map(({ label, run: childRun }, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <BotIcon className="size-3" />
                  <span className="truncate">
                    {label} ({childRun.agentType ?? 'auto'})
                  </span>
                  <span className="ml-auto shrink-0">
                    <RunStatus run={childRun} isRunning={isRunning && !childRun.done} />
                  </span>
                </div>
                <div className="pl-1">
                  <RunTimeline run={childRun} isRunning={isRunning && !childRun.done} />
                </div>
              </div>
            ))
          ) : (
            <RunTimeline run={run} isRunning={isRunning} />
          )}
          {isParallel && run.done?.tokenUsage && (
            <TokenBar
              input={run.done.tokenUsage.inputTokens ?? 0}
              output={run.done.tokenUsage.outputTokens ?? 0}
              total={run.done.tokenUsage.totalTokens ?? 0}
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
