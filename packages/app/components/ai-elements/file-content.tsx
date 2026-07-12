"use client";

import { cn } from "@/lib/utils";
import { FileIcon, FileCodeIcon, FileTextIcon } from "lucide-react";

// ============================================================
// Types
// ============================================================

interface FileContentProps {
  output: Record<string, unknown>;
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

function getFileIcon(type?: string, language?: string) {
  if (type === "image") return FileIcon;
  if (language || type === "text") return FileCodeIcon;
  return FileTextIcon;
}

function getFileIconColor(type?: string, language?: string): string {
  if (type === "image") return "text-purple-500";
  if (language === "typescript" || language === "javascript") return "text-blue-500";
  if (language === "python") return "text-yellow-500";
  if (language === "json" || language === "yaml") return "text-green-500";
  if (language === "markdown") return "text-orange-500";
  return "text-muted-foreground";
}

function getLanguageLabel(language?: string): string {
  const labels: Record<string, string> = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    python: "Python",
    json: "JSON",
    yaml: "YAML",
    markdown: "Markdown",
    html: "HTML",
    css: "CSS",
    bash: "Bash",
    sh: "Shell",
  };
  return language ? labels[language] ?? language : "Text";
}

// ============================================================
// Main Component
// ============================================================

export function FileContent({ output, className }: FileContentProps) {
  const path = (output.path as string) ?? "unknown";
  const content = (output.content as string) ?? "";
  const totalLines = (output.totalLines as number) ?? content.split("\n").length;
  const startLine = (output.startLine as number) ?? 1;
  const shownLines = (output.shownLines as number) ?? totalLines;
  const truncated = output.truncated as boolean | undefined;
  const language = output.language as string | undefined;
  const type = output.type as string | undefined;
  const encoding = output.encoding as string | undefined;
  const truncationInfo = output.truncationInfo as Record<string, unknown> | undefined;
  const nextOffset = output.nextOffset as number | undefined;
  const hasMore = output.hasMore as boolean | undefined;

  const fileName = path.split("/").pop() ?? path;
  const dirPath = path.substring(0, path.lastIndexOf("/"));
  const FileIconComponent = getFileIcon(type, language);
  const iconColor = getFileIconColor(type, language);
  const isImage = type === "image";

  // For images, show preview
  if (isImage && content) {
    return (
      <div className={cn("rounded-md border overflow-hidden bg-background", className)}>
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <FileIconComponent className={cn("size-4", iconColor)} />
          <span className="text-sm font-medium">{fileName}</span>
          {dirPath && (
            <span className="text-xs text-muted-foreground ml-auto truncate max-w-[200px]">
              {dirPath}
            </span>
          )}
          {encoding && (
            <span className="text-xs text-muted-foreground/60">{encoding}</span>
          )}
        </div>
        <div className="p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={content} alt={fileName} className="max-w-full rounded" />
        </div>
      </div>
    );
  }

  // For text files, show code preview
  // 去掉 markdown 代码块标记和已有的行号前缀
  const cleanContent = content
    .replace(/^```\w*\n/m, "")  // 去掉开头的 ```language
    .replace(/\n```$/m, "")     // 去掉结尾的 ```
    .replace(/^\d+: /gm, "");   // 去掉行号前缀 (如 "1: ")
  const lines = cleanContent.split("\n");

  return (
    <div className={cn("rounded-md border overflow-hidden bg-background", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <FileIconComponent className={cn("size-4", iconColor)} />
        <span className="text-sm font-medium">{fileName}</span>
        {language && (
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
            {getLanguageLabel(language)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {shownLines} lines
        </span>
        {truncated && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            (truncated)
          </span>
        )}
        {dirPath && (
          <span className="text-xs text-muted-foreground/60 ml-auto truncate max-w-[200px]">
            {dirPath}
          </span>
        )}
      </div>

      {/* Code content - diff style */}
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => {
              const lineNum = startLine + i;
              return (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="w-12 px-3 py-0.5 text-right select-none text-xs text-muted-foreground/60 border-r bg-muted/20 font-mono">
                    {lineNum}
                  </td>
                  <td className="px-3 py-0.5 text-foreground font-mono text-xs whitespace-pre">
                    {line || " "}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Truncation info */}
      {truncated && truncationInfo && (
        <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
          {truncationInfo.reason === "lines" && (
            <span>
              File has {truncationInfo.originalLines as number} lines, showing first{" "}
              {truncationInfo.shownLines as number} lines.
              {hasMore && nextOffset !== undefined && (
                <span className="ml-2 text-blue-600 dark:text-blue-400">
                  Use offset={nextOffset} to continue.
                </span>
              )}
            </span>
          )}
          {truncationInfo.reason === "bytes" && (
            <span>
              File exceeds {(truncationInfo.originalBytes as number / 1024).toFixed(0)}KB limit.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
