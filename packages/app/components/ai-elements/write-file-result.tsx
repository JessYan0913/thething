"use client";

import { useState } from "react";
import {
  FileIcon,
  FileCodeIcon,
  DownloadIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffView } from "./diff-view";

interface WriteFileResultProps {
  output: Record<string, unknown>;
  input?: Record<string, unknown>;
  onPreview?: (file: { path: string; content: string; language?: string }) => void;
}

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  yaml: "YAML",
  markdown: "Markdown",
  bash: "Bash",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WriteFileResult({ output, input, onPreview }: WriteFileResultProps) {
  const filePath = (output.path as string) ?? (input?.filePath as string) ?? "unknown";
  const language = output.language as string | undefined;

  // 从路径中提取文件名
  const fileName = filePath.split("/").pop() ?? filePath;
  const langLabel = language ? LANGUAGE_LABELS[language] ?? language : "File";

  const handlePreview = () => {
    if (onPreview) {
      onPreview({ path: filePath, content: (output.content as string) ?? "", language });
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Download functionality can be added later if needed
  };

  const diff = output.diff as string | undefined;
  const summary = output.summary as string | undefined;
  const size = output.size as number | undefined;
  const [showDiff, setShowDiff] = useState(false);

  return (
    <div className="my-2">
      {/* 卡片式文件展示 */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div
          className="flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors cursor-pointer"
          onClick={handlePreview}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && handlePreview()}
        >
          {/* 文件图标 */}
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
            {language ? (
              <FileCodeIcon className="size-5 text-blue-500" />
            ) : (
              <FileIcon className="size-5 text-muted-foreground" />
            )}
          </div>

          {/* 文件信息 */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              {langLabel}
              {size !== undefined && ` · ${formatSize(size)}`}
              {summary && ` · ${summary}`}
            </p>
          </div>

          {/* 下载按钮 */}
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
          >
            <DownloadIcon className="size-4" />
            <span>Download</span>
          </button>
        </div>

        {/* Diff toggle */}
        {diff && (
          <div className="border-t">
            <button
              type="button"
              onClick={() => setShowDiff(!showDiff)}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              {showDiff ? (
                <ChevronDownIcon className="size-3" />
              ) : (
                <ChevronRightIcon className="size-3" />
              )}
              <span>Changes</span>
            </button>
            {showDiff && (
              <div className="p-2 pt-0">
                <DiffView diff={diff} defaultExpanded={true} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
