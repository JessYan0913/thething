"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BookOpenIcon,
  CheckCircleIcon,
  XCircleIcon,
  SkipForwardIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface WikiResultProps {
  output: string | Record<string, unknown>;
  toolType: string;
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

function parseSaveWikiOutput(
  output: string | Record<string, unknown>
): {
  saved: number;
  skipped: number;
  failed: number;
  results: Array<{
    name: string;
    action: string;
    success: boolean;
    error?: string;
  }>;
} | null {
  try {
    const data = typeof output === "string" ? JSON.parse(output) : output;
    return {
      saved: (data.saved as number) ?? 0,
      skipped: (data.skipped as number) ?? 0,
      failed: (data.failed as number) ?? 0,
      results: (data.results as any[]) ?? [],
    };
  } catch {
    return null;
  }
}

function parseReadWikiPageOutput(
  output: string | Record<string, unknown>
): {
  found: boolean;
  name?: string;
  description?: string;
  category?: string;
  content?: string;
  message?: string;
} | null {
  try {
    const data = typeof output === "string" ? JSON.parse(output) : output;
    return {
      found: (data.found as boolean) ?? false,
      name: data.name as string | undefined,
      description: data.description as string | undefined,
      category: data.category as string | undefined,
      content: data.content as string | undefined,
      message: data.message as string | undefined,
    };
  } catch {
    return null;
  }
}

function getActionIcon(action: string) {
  switch (action) {
    case "create":
      return <CheckCircleIcon className="size-4 text-emerald-500" />;
    case "update":
      return <CheckCircleIcon className="size-4 text-blue-500" />;
    case "merge":
      return <CheckCircleIcon className="size-4 text-purple-500" />;
    case "replace":
      return <CheckCircleIcon className="size-4 text-orange-500" />;
    case "skip":
      return <SkipForwardIcon className="size-4 text-muted-foreground" />;
    default:
      return <XCircleIcon className="size-4 text-destructive" />;
  }
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    user: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    agent: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    project: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    domain: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    entity: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  };
  return colors[category] ?? "bg-muted text-muted-foreground";
}

// ============================================================
// Components
// ============================================================

function SaveWikiContent({ output }: { output: string | Record<string, unknown> }) {
  const data = parseSaveWikiOutput(output);

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* Stats */}
      <div className="flex items-center gap-3 text-xs">
        {data.saved > 0 && (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="size-3.5" />
            {data.saved} saved
          </span>
        )}
        {data.skipped > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <SkipForwardIcon className="size-3.5" />
            {data.skipped} skipped
          </span>
        )}
        {data.failed > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <XCircleIcon className="size-3.5" />
            {data.failed} failed
          </span>
        )}
      </div>

      {/* Results list */}
      <div className="rounded-md border bg-card overflow-hidden divide-y divide-border/50">
        {data.results.map((result, i) => (
          <div key={i} className="flex items-center gap-2 py-1.5 px-2">
            {getActionIcon(result.action)}
            <span className="text-xs text-muted-foreground uppercase w-16">
              {result.action}
            </span>
            <span className="text-sm font-medium text-foreground">
              [[{result.name}]]
            </span>
            {result.error && (
              <span className="text-xs text-destructive ml-auto truncate max-w-[200px]">
                {result.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadWikiPageContent({ output }: { output: string | Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(true);
  const data = parseReadWikiPageOutput(output);

  if (!data) {
    return null;
  }

  if (!data.found) {
    return (
      <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        {data.message || "Page not found"}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs">
        <BookOpenIcon className="size-4 text-blue-500" />
        <span className="font-medium text-foreground">{data.name}</span>
        {data.category && (
          <span className={cn("px-1.5 py-0.5 rounded text-[10px]", getCategoryColor(data.category))}>
            {data.category}
          </span>
        )}
      </div>

      {/* Description */}
      {data.description && (
        <p className="text-xs text-muted-foreground italic">{data.description}</p>
      )}

      {/* Content */}
      {data.content && (
        <div className="rounded-md border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
          >
            {expanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            <span>Content</span>
            <span className="text-muted-foreground/60">
              ({data.content.length.toLocaleString()} chars)
            </span>
          </button>
          {expanded && (
            <div className="px-3 pb-3 max-h-80 overflow-y-auto">
              <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-sans leading-relaxed">
                {data.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function WikiResult({ output, toolType, className }: WikiResultProps) {
  const isReadWiki = toolType === "tool-read_wiki_page";

  return (
    <div className={cn("space-y-2", className)}>
      {isReadWiki ? (
        <ReadWikiPageContent output={output} />
      ) : (
        <SaveWikiContent output={output} />
      )}
    </div>
  );
}
