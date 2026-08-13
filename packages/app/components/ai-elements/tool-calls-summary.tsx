"use client";

import { ChevronDownIcon, Loader2Icon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 一条消息的工具调用折叠摘要（供摘要行渲染） */
export interface ToolCallSummary {
  count: number;
  /** output-error / output-denied 的数量 */
  errorCount: number;
  /** 恰好一个工具运行中时其标题（如 "Bash: npm test"），用于流式中提示进度 */
  runningTitle?: string;
}

interface ToolLikePart {
  type: string;
  state?: string;
  input?: Record<string, unknown> | null;
  toolName?: string;
}

export interface CollectToolCallSummaryOptions {
  /** 类型命中该集合（如 tool-todo_write）的 part 不计入 */
  exclude?: Set<string>;
  /** 解析工具标题，仅用于 runningTitle */
  resolveTitle?: (part: ToolLikePart) => string | undefined;
}

/**
 * 扫描一条 assistant 消息的 parts，聚合工具调用数 / 失败数 / 当前运行工具。
 * 供「完成后自动折叠为一行摘要」使用。
 */
export function collectToolCallSummary(
  parts: Array<{ type: string; state?: string }>,
  options?: CollectToolCallSummaryOptions,
): ToolCallSummary {
  const exclude = options?.exclude;
  let count = 0;
  let errorCount = 0;
  const activeTitles: string[] = [];

  for (const part of parts) {
    const isTool = part.type.startsWith("tool-") || part.type === "dynamic-tool";
    if (!isTool) continue;
    if (exclude?.has(part.type)) continue;

    count++;
    if (part.state === "output-error" || part.state === "output-denied") {
      errorCount++;
      continue;
    }
    const isActive =
      part.state === "input-streaming" ||
      part.state === "input-available" ||
      part.state === "approval-responded";
    if (isActive) {
      const title = options?.resolveTitle?.(part as ToolLikePart);
      if (title) activeTitles.push(title);
    }
  }

  return { count, errorCount, runningTitle: activeTitles.length === 1 ? activeTitles[0] : undefined };
}

interface ToolCallsSummaryRowProps {
  summary: ToolCallSummary;
  isStreaming: boolean;
  /** 展开态：箭头翻转提示可收起 */
  expanded?: boolean;
  onToggle: () => void;
}

/**
 * 工具调用折叠摘要行：流式中显示「执行中 · N 个工具调用」，
 * 结束后显示「执行了 N 个工具调用」，失败标红。
 * 摘要行在折叠与展开两态都渲染（展开态箭头翻转），保证可反复展开/收起。
 */
export function ToolCallsSummaryRow({ summary, isStreaming, expanded, onToggle }: ToolCallsSummaryRowProps) {
  const { count, errorCount, runningTitle } = summary;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className="flex w-full cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {isStreaming ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin text-blue-500" />
      ) : (
        <WrenchIcon className="size-4 shrink-0" />
      )}
      <span className="truncate">
        {isStreaming
          ? `执行中 · ${count} 个工具调用${runningTitle ? ` · ${runningTitle}` : ""}`
          : `执行了 ${count} 个工具调用`}
      </span>
      {errorCount > 0 && (
        <span className="shrink-0 text-red-600 dark:text-red-400">· {errorCount} 个失败</span>
      )}
      <ChevronDownIcon
        className={cn(
          "ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200",
          expanded ? "rotate-180" : "rotate-0",
        )}
      />
    </div>
  );
}
