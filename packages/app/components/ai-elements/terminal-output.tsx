"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  CheckIcon,
  ClockIcon,
  AlertCircleIcon,
  Loader2Icon,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface TerminalOutputProps {
  output: Record<string, unknown>;
  className?: string;
}

// ============================================================
// Constants
// ============================================================

const MAX_VISIBLE_LINES = 100; // 默认显示的最大行数
const LINE_HEIGHT_THRESHOLD = 500; // 超过此行数时启用虚拟化

// ============================================================
// Helpers
// ============================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getExitCodeColor(code: number | null): string {
  if (code === null) return "text-muted-foreground";
  if (code === 0) return "text-emerald-600 dark:text-emerald-400";
  return "text-red-600 dark:text-red-400";
}

function getExitCodeLabel(code: number | null): string {
  if (code === null) return "killed";
  if (code === 0) return "0";
  return `exit ${code}`;
}

// ============================================================
// Components
// ============================================================

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1 rounded hover:bg-white/10 transition-colors"
      title="Copy"
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-emerald-400" />
      ) : (
        <CopyIcon className="size-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

// ============================================================
// Main Component
// ============================================================

export function TerminalOutput({ output, className }: TerminalOutputProps) {
  const command = (output.command as string) ?? "";
  const stdout = (output.stdout as string) ?? "";
  const stderr = (output.stderr as string) ?? "";
  const exitCode = output.exitCode as number | null;
  const duration = output.duration as number | undefined;
  const timedOut = output.timedOut as boolean | undefined;
  const error = output.error as boolean | undefined;
  const message = (output.message as string) ?? "";
  const background = output.background as boolean | undefined;
  const pid = output.pid as number | undefined;
  const logFile = output.logFile as string | undefined;

  // Background mode: show special UI
  if (background && pid && logFile) {
    return (
      <div className={cn("rounded-md border overflow-hidden bg-card font-mono text-xs", className)}>
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
          <code className="flex-1 truncate">
            <span className="text-blue-600 dark:text-blue-400">$</span>{" "}
            <span className="text-orange-600 dark:text-orange-400">{command}</span>
          </code>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Loader2Icon className="size-3" />
              Running (PID: {pid})
            </span>
            <CopyButton text={command} />
          </div>
        </div>
        <div className="px-3 py-2 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="text-emerald-600">✓</span>
            <span>{message}</span>
          </div>
          <div className="text-muted-foreground/60 text-xs">
            Log: {logFile}
          </div>
        </div>
      </div>
    );
  }

  const hasError = error || (exitCode !== null && exitCode !== 0);
  const hasOutput = stdout.length > 0;
  const hasStderr = stderr.length > 0;

  const [showStdout, setShowStdout] = useState(true);
  const [showStderr, setShowStderr] = useState(true);

  return (
    <div className={cn("rounded-md border overflow-hidden bg-card font-mono text-xs", className)}>
      {/* Command line */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
        <code className="flex-1 truncate">
          <span className="text-blue-600 dark:text-blue-400">$</span>{" "}
          <span className="text-orange-600 dark:text-orange-400">{command}</span>
        </code>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {duration !== undefined && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <ClockIcon className="size-3" />
              {formatDuration(duration)}
            </span>
          )}
          <span className={cn("font-medium", getExitCodeColor(exitCode))}>
            {timedOut ? "⏰ timeout" : getExitCodeLabel(exitCode)}
          </span>
          <CopyButton text={command} />
        </div>
      </div>

      {/* Error message (security/denial) */}
      {error && message && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20">
          <div className="flex items-start gap-2">
            <AlertCircleIcon className="size-4 text-destructive shrink-0 mt-0.5" />
            <span className="text-destructive">{message}</span>
          </div>
        </div>
      )}

      {/* Stdout */}
      {hasOutput && (
        <div>
          <button
            type="button"
            onClick={() => setShowStdout(!showStdout)}
            className="flex items-center gap-1 w-full px-3 py-1.5 text-muted-foreground hover:bg-accent/50 transition-colors"
          >
            {showStdout ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            <span>stdout</span>
            <span className="text-muted-foreground/60">({stdout.length} chars)</span>
          </button>
          {showStdout && (
            <TerminalOutputContent content={stdout} className="text-foreground" />
          )}
        </div>
      )}

      {/* Stderr */}
      {hasStderr && (
        <div>
          <button
            type="button"
            onClick={() => setShowStderr(!showStderr)}
            className="flex items-center gap-1 w-full px-3 py-1.5 text-muted-foreground hover:bg-accent/50 transition-colors"
          >
            {showStderr ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            <span className="text-destructive">stderr</span>
            <span className="text-muted-foreground/60">({stderr.length} chars)</span>
          </button>
          {showStderr && (
            <TerminalOutputContent content={stderr} className="text-destructive" />
          )}
        </div>
      )}

      {/* No output */}
      {!hasOutput && !hasStderr && !error && (
        <div className="px-3 py-3 text-muted-foreground italic">No output</div>
      )}
    </div>
  );
}

// ============================================================
// Optimized Output Component (for large content)
// ============================================================

interface TerminalOutputContentProps {
  content: string;
  className?: string;
  maxLines?: number;
}

/**
 * 优化的终端输出内容组件
 * 对于大型输出，使用行级虚拟化避免渲染卡死
 */
function TerminalOutputContent({ content, className, maxLines = MAX_VISIBLE_LINES }: TerminalOutputContentProps) {
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(() => content.split('\n'), [content]);
  const needsCollapsing = lines.length > maxLines;

  // 如果内容较小，直接渲染
  if (!needsCollapsing || expanded) {
    return (
      <div className={cn("px-3 pb-2 max-h-64 overflow-y-auto", className)}>
        <pre className="whitespace-pre-wrap break-words">{content}</pre>
      </div>
    );
  }

  // 大型内容：显示前 N 行 + 展开按钮
  const previewLines = lines.slice(0, maxLines).join('\n');
  const hiddenLineCount = lines.length - maxLines;

  return (
    <div className={cn("px-3 pb-2", className)}>
      <div className="max-h-64 overflow-y-auto">
        <pre className="whitespace-pre-wrap break-words">{previewLines}</pre>
      </div>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRightIcon className="size-3" />
        <span>Show all {lines.length} lines ({hiddenLineCount} hidden)</span>
      </button>
    </div>
  );
}
