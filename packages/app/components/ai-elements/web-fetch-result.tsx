"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { GlobeIcon, ExternalLinkIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";

// ============================================================
// Types
// ============================================================

interface WebFetchResultProps {
  output: string | Record<string, unknown>;
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

function parseWebFetchOutput(
  output: string | Record<string, unknown>
): {
  success: boolean;
  url: string;
  title?: string;
  content?: string;
  contentType?: string;
  truncated?: boolean;
  originalLength?: number;
  error?: string;
} | null {
  try {
    const data = typeof output === "string" ? JSON.parse(output) : output;
    return {
      success: (data.success as boolean) ?? false,
      url: (data.url as string) ?? "",
      title: data.title as string | undefined,
      content: data.content as string | undefined,
      contentType: data.contentType as string | undefined,
      truncated: data.truncated as boolean | undefined,
      originalLength: data.originalLength as number | undefined,
      error: data.error as string | undefined,
    };
  } catch {
    return null;
  }
}

// Extract domain from URL
function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ============================================================
// Main Component
// ============================================================

export function WebFetchResult({ output, className }: WebFetchResultProps) {
  const [expanded, setExpanded] = useState(true);
  const data = parseWebFetchOutput(output);

  if (!data) {
    return (
      <div className={cn("text-xs text-muted-foreground font-mono", className)}>
        {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
      </div>
    );
  }

  const domain = getDomain(data.url);
  const contentPreview = data.content
    ? data.content.slice(0, 2000)
    : "";
  const hasMoreContent = data.content && data.content.length > 2000;

  return (
    <div className={cn("space-y-2", className)}>
      {/* URL header */}
      <div className="flex items-center gap-2 text-xs">
        <GlobeIcon className="size-4 text-blue-500" />
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground hover:underline flex items-center gap-1"
        >
          {data.title || domain}
          <ExternalLinkIcon className="size-3 text-muted-foreground" />
        </a>
        {data.title && (
          <span className="text-muted-foreground/60 truncate">· {domain}</span>
        )}
      </div>

      {/* Error state */}
      {!data.success && data.error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {data.error}
        </div>
      )}

      {/* Content */}
      {data.success && data.content && (
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
            {data.truncated && (
              <span className="text-amber-600 dark:text-amber-400 ml-1">(truncated)</span>
            )}
          </button>
          {expanded && (
            <div className="px-3 pb-3 max-h-80 overflow-y-auto">
              <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-sans leading-relaxed">
                {contentPreview}
              </pre>
              {hasMoreContent && (
                <p className="text-xs text-muted-foreground mt-2 italic">
                  ... ({data.content.length - 2000} more chars)
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* No content */}
      {data.success && !data.content && (
        <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground italic">
          No content extracted
        </div>
      )}
    </div>
  );
}
