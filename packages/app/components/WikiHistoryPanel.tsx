'use client'

import { useCallback, useEffect, useState } from "react"
import {
  HistoryIcon, Loader2Icon, RotateCcwIcon, XIcon,
  GitCommitIcon, FileDiffIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface WikiRevisionView {
  id: string
  filename: string
  pageName?: string
  createdAt: string
  operation: string
  origin?: string
  contentHash: string
  parentRevisionId?: string
  restoredFromRevisionId?: string
  reason?: string
  sources?: Array<{ type: string; value: string; revision?: string; title?: string }>
}

interface WikiDiffView {
  filename: string
  from: { revisionId?: string; contentHash: string }
  to: { revisionId?: string; contentHash: string }
  changed: boolean
  unifiedDiff: string
}

const OPERATION_LABELS: Record<string, string> = {
  create: "创建",
  update: "更新",
  replace: "替换",
  merge: "合并",
  invalidate: "失效",
  restore: "恢复",
  delete: "删除",
}

const ORIGIN_LABELS: Record<string, string> = {
  ingest: "来源摄取",
  query: "查询综合",
  maintenance: "维护",
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

// ============================================================
// Diff 渲染 — 简单按行着色
// ============================================================

function DiffView({ diff }: { diff: WikiDiffView }) {
  if (!diff.changed) {
    return <p className="text-xs text-muted-foreground p-3">该修订与当前版本内容一致。</p>
  }
  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto p-3 bg-muted/30 rounded-md max-h-80 overflow-y-auto">
      {diff.unifiedDiff.split("\n").map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith("+") && !line.startsWith("+++") && "text-green-600 dark:text-green-400 bg-green-500/10",
            line.startsWith("-") && !line.startsWith("---") && "text-red-600 dark:text-red-400 bg-red-500/10",
            line.startsWith("@@") && "text-blue-600 dark:text-blue-400",
            (line.startsWith("+++") || line.startsWith("---")) && "text-muted-foreground",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  )
}

// ============================================================
// WikiHistoryPanel — 修订历史面板
// ============================================================

export default function WikiHistoryPanel({
  filename,
  onClose,
  onRestored,
}: {
  filename: string
  onClose: () => void
  onRestored: () => void
}) {
  const [revisions, setRevisions] = useState<WikiRevisionView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [diff, setDiff] = useState<WikiDiffView | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)

  const loadRevisions = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/wiki/revisions?filename=${encodeURIComponent(filename)}`)
      if (res.ok) {
        const data = await res.json()
        // 新到旧展示
        setRevisions((data.revisions ?? []).slice().reverse())
      }
    } catch {
      setRevisions([])
    } finally {
      setIsLoading(false)
    }
  }, [filename])

  useEffect(() => { loadRevisions() }, [loadRevisions])

  // 选中 revision → 加载与当前版本的 diff
  const handleSelect = useCallback(async (revisionId: string) => {
    if (selectedId === revisionId) {
      setSelectedId(null)
      setDiff(null)
      return
    }
    setSelectedId(revisionId)
    setDiff(null)
    setDiffLoading(true)
    try {
      const res = await fetch(
        `/api/wiki/revisions?filename=${encodeURIComponent(filename)}&from=${encodeURIComponent(revisionId)}`,
      )
      if (res.ok) {
        const data = await res.json()
        setDiff(data.diff ?? null)
      }
    } catch {
      setDiff(null)
    } finally {
      setDiffLoading(false)
    }
  }, [filename, selectedId])

  const handleRestore = useCallback(async (revisionId: string) => {
    setRestoring(true)
    try {
      const res = await fetch("/api/wiki/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, revisionId, reason: "用户在界面恢复" }),
      })
      if (res.ok) {
        setConfirmRestore(null)
        setSelectedId(null)
        setDiff(null)
        await loadRevisions()
        onRestored()
      }
    } finally {
      setRestoring(false)
    }
  }, [filename, loadRevisions, onRestored])

  return (
    <div className="flex flex-col h-full min-h-0 border-l bg-muted/10">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <HistoryIcon className="size-4" />
          修订历史
          {!isLoading && (
            <span className="text-xs text-muted-foreground font-normal">{revisions.length} 个修订</span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* Revision list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
            <Loader2Icon className="size-4 animate-spin mr-2" />
            加载中...
          </div>
        ) : revisions.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4">该页面还没有修订记录。</p>
        ) : (
          <div className="p-2 space-y-1">
            {revisions.map((rev, i) => (
              <div key={rev.id}>
                <button
                  className={cn(
                    "w-full text-left rounded-md px-3 py-2 transition-colors cursor-pointer",
                    selectedId === rev.id ? "bg-accent" : "hover:bg-accent/50",
                  )}
                  onClick={() => handleSelect(rev.id)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GitCommitIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full shrink-0",
                      rev.operation === "restore"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : rev.operation === "create"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                    )}>
                      {OPERATION_LABELS[rev.operation] ?? rev.operation}
                    </span>
                    {rev.origin && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {ORIGIN_LABELS[rev.origin] ?? rev.origin}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                      {formatTime(rev.createdAt)}
                    </span>
                  </div>
                  {rev.reason && (
                    <p className="text-[10px] text-muted-foreground mt-1 truncate">{rev.reason}</p>
                  )}
                  {rev.restoredFromRevisionId && (
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">
                      ← 恢复自 {rev.restoredFromRevisionId.slice(0, 17)}
                    </p>
                  )}
                </button>

                {/* Expanded: diff vs current + restore */}
                {selectedId === rev.id && (
                  <div className="mx-1 mt-1 mb-2 space-y-2">
                    <div className="flex items-center justify-between px-2">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <FileDiffIcon className="size-3" />
                        与当前版本比较
                      </span>
                      {/* 最新 revision 无需恢复 */}
                      {i !== 0 && (
                        confirmRestore === rev.id ? (
                          <span className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-6 text-[10px] px-2"
                              disabled={restoring}
                              onClick={() => handleRestore(rev.id)}
                            >
                              {restoring ? <Loader2Icon className="size-3 animate-spin" /> : "确认恢复"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] px-2"
                              disabled={restoring}
                              onClick={() => setConfirmRestore(null)}
                            >
                              取消
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => setConfirmRestore(rev.id)}
                          >
                            <RotateCcwIcon className="size-3 mr-1" />
                            恢复到此版本
                          </Button>
                        )
                      )}
                    </div>
                    {diffLoading ? (
                      <div className="flex items-center justify-center py-4 text-muted-foreground text-xs">
                        <Loader2Icon className="size-3.5 animate-spin mr-2" />
                        加载 diff...
                      </div>
                    ) : diff ? (
                      <DiffView diff={diff} />
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
