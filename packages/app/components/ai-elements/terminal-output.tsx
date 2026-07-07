"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  CheckIcon,
  ClockIcon,
  AlertCircleIcon,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface TerminalOutputProps {
  output: Record<string, unknown>;
  className?: string;
}

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
            <div className="px-3 pb-2 max-h-64 overflow-y-auto">
              <pre className="whitespace-pre-wrap break-words text-foreground">{stdout}</pre>
            </div>
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
            <div className="px-3 pb-2 max-h-64 overflow-y-auto">
              <pre className="whitespace-pre-wrap break-words text-destructive">{stderr}</pre>
            </div>
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
