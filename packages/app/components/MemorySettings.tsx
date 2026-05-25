import { useCallback, useEffect, useState } from "react"
import {
  DatabaseIcon, RefreshCwIcon, FileTextIcon, RulerIcon,
  FolderIcon, UserIcon, ArrowLeftIcon, PanelLeftOpenIcon,
  PanelRightOpenIcon, BookOpenIcon, HardDriveIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DirectoryTree } from "@/components/DirectoryTree"
import { FilePreview } from "@/components/FilePreview"
import { cn } from "@/lib/utils"

interface MemoryEntryView {
  name: string
  description: string
  type: string
  content: string
  filePath: string
  lines: number
  sizeKb: number
  userId: string
}

interface EntrypointView {
  userId: string
  content: string
  filePath: string
}

interface SelectedDetail {
  userId: string
  filePath: string
  memoryDir: string
}

const typeLabels: Record<string, { label: string; color: string }> = {
  user: { label: "用户记忆", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25" },
  feedback: { label: "反馈记忆", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/25" },
  project: { label: "项目记忆", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25" },
  reference: { label: "参考记忆", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25" },
}

export default function MemorySettings() {
  const [entries, setEntries] = useState<MemoryEntryView[]>([])
  const [entrypoints, setEntrypoints] = useState<EntrypointView[]>([])
  const [baseDir, setBaseDir] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  // Detail view state
  const [detail, setDetail] = useState<SelectedDetail | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [showTree, setShowTree] = useState(true)
  const [showPreview, setShowPreview] = useState(true)

  const loadMemory = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/memory")
      if (res.ok) {
        const data = await res.json()
        setEntries(data.memory ?? [])
        setEntrypoints(data.entrypoints ?? [])
        setBaseDir(data.baseDir ?? "")
      }
    } catch {
      setEntries([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadMemory() }, [loadMemory])

  const handleEntryClick = (entry: MemoryEntryView) => {
    const memoryDir = entry.filePath.replace(/\/[^/]+\.md$/, "")
    setDetail({ userId: entry.userId, filePath: entry.filePath, memoryDir })
    setSelectedFilePath(entry.filePath)
    setShowTree(true)
    setShowPreview(true)
  }

  const handleEntrypointClick = (ep: EntrypointView) => {
    const memoryDir = ep.filePath.replace(/\/[^/]+\.md$/, "")
    setDetail({ userId: ep.userId, filePath: ep.filePath, memoryDir })
    setSelectedFilePath(ep.filePath)
    setShowTree(true)
    setShowPreview(true)
  }

  const handleBack = () => {
    setDetail(null)
    setSelectedFilePath(null)
  }

  const totalLines = entries.reduce((sum, e) => sum + e.lines, 0)
  const totalSizeKb = entries.reduce((sum, e) => sum + e.sizeKb, 0)

  // Detail view
  if (detail) {
    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeftIcon className="size-4" />
              返回
            </Button>
            <div className="flex items-center gap-2 min-w-0">
              <DatabaseIcon className="size-5 shrink-0" />
              <h1 className="text-lg font-semibold truncate">{detail.userId}</h1>
              <Badge variant="secondary" className="text-xs shrink-0">
                记忆详情
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTree(!showTree)}
              className={cn(showTree && "bg-accent")}
            >
              <PanelLeftOpenIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              className={cn(showPreview && "bg-accent")}
            >
              <PanelRightOpenIcon className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={loadMemory} disabled={isLoading}>
              <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Split view */}
        <div className="flex-1 flex overflow-hidden">
          {showTree && (
            <div className="w-72 border-r overflow-hidden flex flex-col shrink-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserIcon className="size-3.5" />
                  <span className="truncate max-w-44">{detail.userId}</span>
                  <span className="text-muted-foreground/40">/</span>
                  <span className="text-muted-foreground/70">memory</span>
                </div>
              </div>
              <DirectoryTree
                rootPath={detail.memoryDir}
                selectedFile={selectedFilePath}
                onFileSelect={setSelectedFilePath}
                className="flex-1 py-1"
              />
            </div>
          )}

          {showPreview && (
            <div className="flex-1 overflow-hidden p-4">
              <FilePreview
                filePath={selectedFilePath}
                className="h-full"
                minHeight={400}
              />
            </div>
          )}

          {!showTree && !showPreview && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground/40 text-sm">
              使用顶栏按钮切换面板显示
            </div>
          )}
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <Badge variant="secondary" className="text-xs">
          {entries.length} 条记忆
        </Badge>
        <Button variant="ghost" size="sm" onClick={loadMemory} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : entries.length === 0 && entrypoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <DatabaseIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">暂无记忆</p>
              <p className="text-xs">
                在 .thething/memory/users/{`{userId}`}/memory/ 目录下创建 Markdown 文件来添加记忆
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="rounded-lg border p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <DatabaseIcon className="size-3" />
                  记忆条目
                </div>
                <p className="text-2xl font-semibold">{entries.length}</p>
              </div>
              <div className="rounded-lg border p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserIcon className="size-3" />
                  用户目录
                </div>
                <p className="text-2xl font-semibold">{entrypoints.length}</p>
              </div>
              <div className="rounded-lg border p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RulerIcon className="size-3" />
                  总行数
                </div>
                <p className="text-2xl font-semibold">{totalLines.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <HardDriveIcon className="size-3" />
                  总大小
                </div>
                <p className="text-2xl font-semibold">{totalSizeKb.toFixed(1)} KB</p>
              </div>
            </div>

            {/* Base directory */}
            {baseDir && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                <FolderIcon className="size-3" />
                <span className="font-mono">{baseDir}</span>
              </div>
            )}

            {/* Entrypoints */}
            {entrypoints.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium flex items-center gap-1.5">
                  <BookOpenIcon className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">入口文件 (MEMORY.md)</span>
                </h2>
                {entrypoints.map((ep, i) => (
                  <button
                    key={i}
                    onClick={() => handleEntrypointClick(ep)}
                    className="rounded-lg border p-4 space-y-2 w-full text-left hover:border-accent/50 hover:bg-accent/20 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <UserIcon className="size-4 text-muted-foreground" />
                      <span className="font-medium">{ep.userId}</span>
                      <span className="text-xs text-muted-foreground/50 truncate font-mono">
                        {ep.filePath}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground/70 bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-32">
                      {ep.content.slice(0, 500)}
                      {ep.content.length > 500 && (
                        <span className="text-muted-foreground/40">...</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Memory files */}
            {entries.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium flex items-center gap-1.5">
                  <FileTextIcon className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">记忆文件</span>
                </h2>
                {entries.map((entry, i) => {
                  const typeInfo = typeLabels[entry.type] ?? { label: entry.type, color: "" }

                  return (
                    <button
                      key={i}
                      onClick={() => handleEntryClick(entry)}
                      className="rounded-lg border p-4 space-y-3 w-full text-left hover:border-accent/50 hover:bg-accent/20 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">{entry.name}</span>
                              <Badge className={`text-xs border-0 ${typeInfo.color}`}>
                                {typeInfo.label}
                              </Badge>
                              <span className="text-xs text-muted-foreground/60">
                                @{entry.userId}
                              </span>
                            </div>
                            {entry.description && (
                              <p className="text-xs text-muted-foreground/70 mt-0.5">
                                {entry.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                          <div className="flex items-center gap-1">
                            <RulerIcon className="size-3" />
                            <span>{entry.lines} 行</span>
                          </div>
                          <span>{entry.sizeKb.toFixed(1)} KB</span>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground/60 bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-24">
                        {entry.content.slice(0, 200)}
                        {entry.content.length > 200 && (
                          <span className="text-muted-foreground/40">...</span>
                        )}
                      </div>

                      {entry.filePath && (
                        <div className="text-xs text-muted-foreground/50 font-mono truncate" title={entry.filePath}>
                          <FolderIcon className="size-3 inline mr-1" />
                          {entry.filePath}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
