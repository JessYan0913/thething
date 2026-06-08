"use client";

import {
  FileIcon,
  FileCodeIcon,
  DownloadIcon,
} from "lucide-react";

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

export function WriteFileResult({ output, input, onPreview }: WriteFileResultProps) {
  const filePath = (output.path as string) ?? (input?.filePath as string) ?? "unknown";
  const language = output.language as string | undefined;
  const preview = output.preview as string | undefined;
  const bytesWritten = output.bytesWritten as number | undefined;

  // 从路径中提取文件名
  const fileName = filePath.split("/").pop() ?? filePath;
  const langLabel = language ? LANGUAGE_LABELS[language] ?? language : "File";

  const handlePreview = () => {
    if (onPreview && preview) {
      onPreview({ path: filePath, content: preview, language });
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (preview) {
      const blob = new Blob([preview], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="my-2">
      {/* 卡片式文件展示 */}
      <div
        className="flex items-center gap-3 rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors cursor-pointer"
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
          <p className="text-xs text-muted-foreground">{langLabel}</p>
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
    </div>
  );
}
