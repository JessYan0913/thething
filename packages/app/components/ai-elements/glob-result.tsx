"use client";

import { cn } from "@/lib/utils";
import { FileIcon, FolderIcon, SearchIcon } from "lucide-react";

// ============================================================
// Types
// ============================================================

interface GlobResultProps {
  output: string | Record<string, unknown>;
  input?: Record<string, unknown>;
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

function parseGlobOutput(
  output: string | Record<string, unknown>
): {
  pattern: string;
  searchDir: string;
  files: string[];
  count: number;
  totalCount: number;
  truncated: boolean;
  note?: string;
} | null {
  try {
    const data = typeof output === "string" ? JSON.parse(output) : output;
    return {
      pattern: (data.pattern as string) ?? "",
      searchDir: (data.searchDir as string) ?? "",
      files: (data.files as string[]) ?? [],
      count: (data.count as number) ?? 0,
      totalCount: (data.totalCount as number) ?? 0,
      truncated: (data.truncated as boolean) ?? false,
      note: data.note as string | undefined,
    };
  } catch {
    return null;
  }
}

// Extract filename from path
function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

// Get directory path
function getDirPath(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || ".";
}

// Get file extension for icon color
function getFileColor(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const colorMap: Record<string, string> = {
    ts: "text-blue-500",
    tsx: "text-blue-500",
    js: "text-yellow-500",
    jsx: "text-yellow-500",
    py: "text-green-500",
    json: "text-green-500",
    md: "text-orange-500",
    css: "text-purple-500",
    html: "text-orange-600",
    svg: "text-pink-500",
  };
  return colorMap[ext ?? ""] ?? "text-muted-foreground";
}

// ============================================================
// Components
// ============================================================

function FileItem({ filePath }: { filePath: string }) {
  const fileName = getFileName(filePath);
  const dirPath = getDirPath(filePath);
  const fileColor = getFileColor(fileName);

  return (
    <div className="flex items-center gap-2 py-1 px-2 hover:bg-accent/50 rounded">
      <FileIcon className={cn("size-4 shrink-0", fileColor)} />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{fileName}</span>
      </div>
      {dirPath && dirPath !== "." && (
        <span className="text-xs text-muted-foreground/60 truncate max-w-[200px]">
          {dirPath}
        </span>
      )}
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function GlobResult({ output, input, className }: GlobResultProps) {
  const data = parseGlobOutput(output);

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
          <span className="font-medium text-foreground">{data.count}</span> file{data.count !== 1 ? "s" : ""}
          {data.totalCount > data.count && (
            <span className="text-muted-foreground/60"> of {data.totalCount}</span>
          )}
        </span>
        {data.truncated && (
          <>
            <span>·</span>
            <span className="text-amber-600 dark:text-amber-400">truncated</span>
          </>
        )}
      </div>

      {/* File list */}
      <div className="rounded-md border bg-card overflow-hidden divide-y divide-border/50 max-h-80 overflow-y-auto">
        {data.files.map((file, i) => (
          <FileItem key={i} filePath={file} />
        ))}
      </div>

      {/* Truncation note */}
      {data.note && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{data.note}</p>
      )}
    </div>
  );
}
