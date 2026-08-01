"use client";

import { FileCodeIcon, FileIcon, FilePlusIcon, FilePenIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 单个产出文件条目(按路径去重后) */
export interface FileOutputEntry {
  path: string;
  /** created: 本轮新建; modified: 本轮修改(覆盖/追加/编辑) */
  kind: "created" | "modified";
  size?: number;
  language?: string;
  additions?: number;
  deletions?: number;
}

/** 从 unified diff 文本统计 +N -M(排除 +++/--- 文件头) */
function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

/**
 * 扫描一轮 assistant 消息的 parts,聚合 write_file / edit_file 的成功产出。
 * 按路径去重:同一文件多次写入/编辑时,created 状态保留首次,统计取累计。
 */
export function collectFileOutputs(parts: Array<{ type: string; state?: string; output?: unknown }>): FileOutputEntry[] {
  const byPath = new Map<string, FileOutputEntry>();

  for (const part of parts) {
    if (part.type !== "tool-write_file" && part.type !== "tool-edit_file") continue;
    if (part.state !== "output-available") continue;
    const out = part.output as Record<string, unknown> | undefined;
    if (!out || out.error || typeof out.path !== "string") continue;

    const path = out.path;
    const diff = typeof out.diff === "string" ? out.diff : undefined;
    const stats = diff ? countDiffLines(diff) : undefined;
    const isCreate = part.type === "tool-write_file" && out.created === true;

    const prev = byPath.get(path);
    const entry: FileOutputEntry = {
      path,
      // 首次新建后即使再次编辑,对用户而言仍是「本轮新建」
      kind: prev?.kind === "created" || isCreate ? "created" : "modified",
      size: typeof out.size === "number" ? out.size : prev?.size,
      language: typeof out.language === "string" ? out.language : prev?.language,
      additions: (prev?.additions ?? 0) + (stats?.additions ?? 0) || undefined,
      deletions: (prev?.deletions ?? 0) + (stats?.deletions ?? 0) || undefined,
    };
    byPath.set(path, entry);
  }

  return [...byPath.values()];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileOutputsSummaryProps {
  entries: FileOutputEntry[];
  onOpen?: (entry: FileOutputEntry) => void;
}

/** 一轮任务结束后的产出文件汇总卡 */
export function FileOutputsSummary({ entries, onOpen }: FileOutputsSummaryProps) {
  if (entries.length === 0) return null;

  return (
    <div className="not-prose mt-3 overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
        本次产出 {entries.length} 个文件
      </div>
      <ul>
        {entries.map((entry) => {
          const fileName = entry.path.split("/").pop() ?? entry.path;
          const dir = entry.path.slice(0, entry.path.length - fileName.length);
          return (
            <li key={entry.path}>
              <button
                type="button"
                onClick={onOpen ? () => onOpen(entry) : undefined}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  onOpen && "cursor-pointer hover:bg-accent/50 transition-colors",
                )}
              >
                {entry.kind === "created" ? (
                  <FilePlusIcon className="size-4 shrink-0 text-green-600" />
                ) : (
                  <FilePenIcon className="size-4 shrink-0 text-blue-500" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {dir && <span className="text-muted-foreground">{dir}</span>}
                  <span className="font-medium">{fileName}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {entry.additions !== undefined && (
                    <span className="text-green-600">+{entry.additions} </span>
                  )}
                  {entry.deletions !== undefined && (
                    <span className="text-red-500">-{entry.deletions} </span>
                  )}
                  {entry.kind === "created" ? "新建" : "修改"}
                  {entry.size !== undefined && ` · ${formatSize(entry.size)}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
