"use client";

import { Loader2Icon } from "lucide-react";

const TAIL_LINES = 12;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface WriteFileStreamingCardProps {
  filePath?: string;
  content: string;
}

/**
 * write_file 流式输入期间的尾部预览卡:
 * 滚动展示最后 N 行 + 实时行数/字节计数,输入结束后由结果卡替换。
 */
export function WriteFileStreamingCard({ filePath, content }: WriteFileStreamingCardProps) {
  const lines = content.split("\n");
  const lineCount = lines.length;
  const tail = lines.slice(-TAIL_LINES);
  const startLine = lineCount - tail.length + 1;
  const bytes = new TextEncoder().encode(content).length;

  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
        <Loader2Icon className="size-4 shrink-0 animate-spin text-blue-500" />
        <span className="truncate text-sm font-medium">{filePath ?? "write file"}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {lineCount} lines · {formatSize(bytes)}
        </span>
      </div>
      <div className="overflow-x-auto px-3 py-2 font-mono text-xs text-muted-foreground">
        {startLine > 1 && <div className="select-none opacity-50">…</div>}
        {tail.map((line, i) => {
          const isLast = i === tail.length - 1;
          return (
            <div key={startLine + i} className="flex whitespace-pre">
              <span className="w-8 shrink-0 select-none pr-3 text-right opacity-50">
                {startLine + i}
              </span>
              <span>
                {line}
                {isLast && <span className="animate-pulse text-foreground">▌</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
