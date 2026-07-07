"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
  FileIcon,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

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
  matches: GrepMatch[];
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
      matches: (data.matches as GrepMatch[]) ?? [],
      formattedOutput: data.formattedOutput as string | undefined,
      note: data.note as string | undefined,
    };
  } catch {
    return null;
  }
}

// Group matches by file
function groupByFile(matches: GrepMatch[]): Map<string, GrepMatch[]> {
  const groups = new Map<string, GrepMatch[]>();
  for (const match of matches) {
    const file = match.file;
    if (!groups.has(file)) {
      groups.set(file, []);
    }
    groups.get(file)!.push(match);
  }
  return groups;
}

// Highlight search pattern in text
function highlightText(text: string, pattern: string): React.ReactNode {
  if (!pattern) return text;

  try {
    const regex = new RegExp(`(${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/50 text-inherit rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  } catch {
    return text;
  }
}

// ============================================================
// Components
// ============================================================

function MatchItem({ match, pattern }: { match: GrepMatch; pattern: string }) {
  const fileName = match.file.split("/").pop() ?? match.file;
  const dirPath = match.file.substring(0, match.file.lastIndexOf("/"));

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 hover:bg-accent/50 rounded">
      <FileIcon className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-foreground truncate">{fileName}</span>
          <span className="text-muted-foreground">:</span>
          <span className="text-blue-600 dark:text-blue-400 font-mono">{match.line}</span>
          {dirPath && (
            <span className="text-muted-foreground/50 text-[10px] truncate">
              {dirPath}
            </span>
          )}
        </div>
        <pre className="mt-1 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-words">
          {highlightText(match.content, pattern)}
        </pre>
      </div>
    </div>
  );
}

function FileGroup({
  file,
  matches,
  pattern,
}: {
  file: string;
  matches: GrepMatch[];
  pattern: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const fileName = file.split("/").pop() ?? file;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors"
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3 text-muted-foreground" />
        )}
        <FileIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{fileName}</span>
        <span className="text-muted-foreground">
          ({matches.length} match{matches.length > 1 ? "es" : ""})
        </span>
      </button>
      {expanded && (
        <div className="ml-4 divide-y divide-border/50">
          {matches.map((match, i) => (
            <MatchItem key={i} match={match} pattern={pattern} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function GrepResult({ output, input, className }: GrepResultProps) {
  const data = parseGrepOutput(output);

  if (!data) {
    // Fallback: render as JSON
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
  const grouped = groupByFile(data.matches);

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

      {/* Formatted output with context */}
      {data.formattedOutput ? (
        <div className="rounded-md border bg-card overflow-hidden">
          <pre className="p-3 text-xs font-mono text-foreground overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
            {data.formattedOutput}
          </pre>
        </div>
      ) : (
        /* Grouped matches */
        <div className="rounded-md border bg-card overflow-hidden divide-y divide-border/50">
          {Array.from(grouped.entries()).map(([file, matches]) => (
            <FileGroup key={file} file={file} matches={matches} pattern={pattern} />
          ))}
        </div>
      )}

      {/* Truncation note */}
      {data.note && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{data.note}</p>
      )}
    </div>
  );
}
