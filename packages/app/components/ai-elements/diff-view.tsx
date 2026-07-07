"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

// ============================================================
// Types
// ============================================================

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: "context" | "add" | "delete";
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

interface DiffStats {
  additions: number;
  deletions: number;
}

interface DiffViewProps {
  diff: string;
  className?: string;
  showStats?: boolean;
  defaultExpanded?: boolean;
  maxLines?: number;
  maxHeight?: number;
}

// ============================================================
// Parser: unified diff string → structured hunks
// ============================================================

function parseDiff(diffStr: string): { hunks: DiffHunk[]; stats: DiffStats } {
  const lines = diffStr.split("\n");
  const hunks: DiffHunk[] = [];
  const stats: DiffStats = { additions: 0, deletions: 0 };

  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Skip file headers (--- / +++)
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }

    // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      currentHunk = {
        header: hunkMatch[3]?.trim() ?? "",
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    // Context line
    if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNum: oldLine,
        newLineNum: newLine,
      });
      oldLine++;
      newLine++;
    }
    // Deletion
    else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "delete",
        content: line.slice(1),
        oldLineNum: oldLine,
        newLineNum: null,
      });
      oldLine++;
      stats.deletions++;
    }
    // Addition
    else if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        oldLineNum: null,
        newLineNum: newLine,
      });
      newLine++;
      stats.additions++;
    }
  }

  // Push last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return { hunks, stats };
}

// ============================================================
// Components
// ============================================================

function DiffStatsBadge({ stats }: { stats: DiffStats }) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      {stats.additions > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400">
          +{stats.additions}
        </span>
      )}
      {stats.deletions > 0 && (
        <span className="text-red-600 dark:text-red-400">
          -{stats.deletions}
        </span>
      )}
    </div>
  );
}

function DiffLineComponent({
  line,
  showLineNumbers,
}: {
  line: DiffLine;
  showLineNumbers: boolean;
}) {
  const bgColor =
    line.type === "add"
      ? "bg-emerald-500/10"
      : line.type === "delete"
        ? "bg-red-500/10"
        : "";

  const prefix =
    line.type === "add" ? "+" : line.type === "delete" ? "-" : " ";

  const prefixColor =
    line.type === "add"
      ? "text-emerald-600 dark:text-emerald-400"
      : line.type === "delete"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "flex font-mono text-xs leading-5",
        bgColor,
        line.type !== "context" && "font-medium"
      )}
    >
      {showLineNumbers && (
        <>
          <span className="w-12 shrink-0 text-right pr-2 text-muted-foreground/50 select-none">
            {line.oldLineNum ?? ""}
          </span>
          <span className="w-12 shrink-0 text-right pr-2 text-muted-foreground/50 select-none">
            {line.newLineNum ?? ""}
          </span>
        </>
      )}
      <span className={cn("w-5 shrink-0 text-center select-none", prefixColor)}>
        {prefix}
      </span>
      <span className="flex-1 whitespace-pre overflow-x-auto">
        {line.content}
      </span>
    </div>
  );
}

function DiffHunkComponent({
  hunk,
  defaultExpanded,
  showLineNumbers,
}: {
  hunk: DiffHunk;
  defaultExpanded: boolean;
  showLineNumbers: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors font-mono"
      >
        {expanded ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        <span className="truncate">
          {hunk.header || "Changes"}
        </span>
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          {hunk.lines.map((line, i) => (
            <DiffLineComponent
              key={i}
              line={line}
              showLineNumbers={showLineNumbers}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Export
// ============================================================

export function DiffView({
  diff,
  className,
  showStats = true,
  defaultExpanded = true,
  maxLines = 200,
  maxHeight = 400,
}: DiffViewProps) {
  const { hunks, stats } = parseDiff(diff);

  if (hunks.length === 0) {
    return null;
  }

  // Calculate total lines
  const totalLines = hunks.reduce((acc, h) => acc + h.lines.length, 0);
  const needsCollapsing = totalLines > maxLines;

  // Show line numbers if there are many lines
  const showLineNumbers = totalLines > 10;

  return (
    <div
      className={cn(
        "rounded-md border overflow-hidden bg-background",
        className
      )}
    >
      {/* Header with stats */}
      {showStats && (
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <span className="text-xs text-muted-foreground font-medium">
            {hunks.length} hunk{hunks.length > 1 ? "s" : ""}
          </span>
          <DiffStatsBadge stats={stats} />
        </div>
      )}

      {/* Diff content */}
      <div className="divide-y divide-border/50 overflow-y-auto" style={{ maxHeight }}>
        {hunks.map((hunk, i) => (
          <DiffHunkComponent
            key={i}
            hunk={hunk}
            defaultExpanded={
              defaultExpanded && (!needsCollapsing || i < 3)
            }
            showLineNumbers={showLineNumbers}
          />
        ))}
      </div>
    </div>
  );
}

// Compact inline version for tool results
export function DiffViewCompact({
  diff,
  className,
}: {
  diff: string;
  className?: string;
}) {
  const { stats } = parseDiff(diff);

  return (
    <div className={cn("flex items-center gap-3 text-xs", className)}>
      <DiffStatsBadge stats={stats} />
    </div>
  );
}
