"use client";

import { cn } from "@/lib/utils";
import { SearchIcon } from "lucide-react";

// ============================================================
// Types
// ============================================================

interface GrepResultProps {
  output: string | Record<string, unknown>;
  input?: Record<string, unknown>;
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

function parseGrepOutput(
  output: string | Record<string, unknown>
): {
  pattern: string;
  totalMatches: number;
  matchesReturned: number;
  truncated: boolean;
  searchEngine: string;
  formattedOutput?: string;
  note?: string;
} | null {
  try {
    const data =
      typeof output === "string" ? JSON.parse(output) : output;
    return {
      pattern: (data.pattern as string) ?? "",
      totalMatches: (data.totalMatches as number) ?? 0,
      matchesReturned: (data.matchesReturned as number) ?? 0,
      truncated: (data.truncated as boolean) ?? false,
      searchEngine: (data.searchEngine as string) ?? "unknown",
      formattedOutput: data.formattedOutput as string | undefined,
      note: data.note as string | undefined,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Main Component
// ============================================================

export function GrepResult({ output, input, className }: GrepResultProps) {
  const data = parseGrepOutput(output);

  if (!data) {
    return (
      <div className={cn("text-xs text-muted-foreground font-mono", className)}>
        {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
      </div>
    );
  }

  const inputPattern =
    input && typeof input === "object"
      ? (input as Record<string, unknown>).pattern
      : undefined;
  const pattern = data.pattern || (typeof inputPattern === "string" ? inputPattern : "");

  return (
    <div className={cn("space-y-2", className)}>
      {/* Stats header */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <SearchIcon className="size-3.5" />
          <span className="font-mono text-foreground">"{pattern}"</span>
        </div>
        <span>·</span>
        <span>
          <span className="font-medium text-foreground">{data.totalMatches}</span> match{data.totalMatches !== 1 ? "es" : ""}
        </span>
        <span>·</span>
        <span>{data.searchEngine}</span>
        {data.truncated && (
          <>
            <span>·</span>
            <span className="text-amber-600 dark:text-amber-400">truncated</span>
          </>
        )}
      </div>

      {/* Compact text output (grep now defaults to text format, no matches array) */}
      {data.formattedOutput && (
        <div className="rounded-md border bg-card overflow-hidden">
          <pre className="p-3 text-xs font-mono text-foreground overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
            {data.formattedOutput}
          </pre>
        </div>
      )}

      {/* Truncation / per-file cap note */}
      {data.note && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{data.note}</p>
      )}
    </div>
  );
}
