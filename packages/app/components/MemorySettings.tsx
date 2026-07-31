import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import {
  SearchIcon, TrashIcon, PlusIcon, RefreshCwIcon, BrainIcon,
  UserIcon, BotIcon, FolderIcon, GlobeIcon, BoxIcon,
  MoreVerticalIcon, NetworkIcon, ListIcon, HeartPulseIcon,
  ScrollTextIcon, XIcon, Loader2Icon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getWikiCategoryMeta, listWikiCategories } from "@/lib/wiki-category"

const WikiGraph = dynamic(() => import("./WikiGraph"), { ssr: false })
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface WikiPageView {
  name: string
  description: string
  category: string
  content: string
  filename: string
  created: string
  updated: string
  lines: number
  sizeKb: number
}

const categoryConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  user: { label: "用户", icon: <UserIcon className="size-3.5" />, color: "text-blue-500" },
  agent: { label: "Agent", icon: <BotIcon className="size-3.5" />, color: "text-purple-500" },
  project: { label: "项目", icon: <FolderIcon className="size-3.5" />, color: "text-amber-500" },
  domain: { label: "领域", icon: <GlobeIcon className="size-3.5" />, color: "text-green-500" },
  entity: { label: "实体", icon: <BoxIcon className="size-3.5" />, color: "text-cyan-500" },
}

// 分类是自由字符串：已知分类有专属图标，未知分类用中性样式兜底。
function getCategoryView(category: string) {
  return categoryConfig[category] ?? {
    label: getWikiCategoryMeta(category).label,
    icon: <BrainIcon className="size-3.5" />,
    color: "text-slate-500",
  }
}

function getRelativeTime(dateStr: string) {
  const ageMs = Date.now() - new Date(dateStr).getTime()
  const ageDays = Math.floor(ageMs / 86400000)
  if (ageDays < 1) return "今天"
  if (ageDays < 30) return `${ageDays}天前`
  if (ageDays < 365) return `${Math.floor(ageDays / 30)}个月前`
  return `${Math.floor(ageDays / 365)}年前`
}

// ============================================================
// WikiCard — 卡片组件
// ============================================================

function WikiCard({
  page,
  onClick,
  onDelete,
}: {
  page: WikiPageView
  onClick: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const config = getCategoryView(page.category)

  return (
    <div className="rounded-lg border p-4 transition-colors hover:border-accent/50 hover:bg-accent/20 relative">
      <div className="flex items-start justify-between gap-4 min-w-0">
        <button
          onClick={onClick}
          className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer"
        >
          <span className={cn("size-4 mt-0.5 shrink-0", config.color)}>{config.icon}</span>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-medium text-sm truncate">{page.name}</span>
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full",
                getWikiCategoryMeta(page.category).chip,
              )}>
                {config.label}
              </span>
            </div>
            {page.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {page.description}
              </p>
            )}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 pt-1">
              <span>{page.lines} 行</span>
              <span>{page.sizeKb.toFixed(1)} KB</span>
              <span>更新于 {getRelativeTime(page.updated)}</span>
            </div>
          </div>
        </button>

        {/* Actions menu */}
        <div className="relative shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
          >
            <MoreVerticalIcon className="size-4" />
          </Button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-50 w-36 rounded-md border bg-popover shadow-md">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 cursor-pointer rounded-md"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onDelete()
                  }}
                >
                  <TrashIcon className="size-3.5" />
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// MemorySettings — 主组件
// ============================================================

export default function MemorySettings() {
  const router = useRouter()
  const [pages, setPages] = useState<WikiPageView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WikiPageView | null>(null)
  const [viewMode, setViewMode] = useState<"list" | "graph">("list")

  // Lint 健康检查
  const [lintRunning, setLintRunning] = useState(false)
  const [lintReport, setLintReport] = useState<{
    checked: number
    fixed: number
    issues: Array<{ type: string; severity: string; pages: string[]; description: string; suggestion?: string }>
  } | null>(null)

  // 操作日志时间线
  const [showLog, setShowLog] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [logEntries, setLogEntries] = useState<Array<{
    timestamp: string
    operation: string
    description: string
    details: string[]
  }>>([])

  // 创建对话框
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formName, setFormName] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formCategory, setFormCategory] = useState<string>("domain")
  const [formContent, setFormContent] = useState("")
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadPages = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/wiki")
      if (res.ok) {
        const data = await res.json()
        setPages(data.pages ?? [])
      }
    } catch {
      setPages([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadPages() }, [loadPages])

  const filtered = useMemo(() => {
    let result = pages
    if (categoryFilter) result = result.filter((e) => e.category === categoryFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q)
      )
    }
    return result
  }, [pages, categoryFilter, search])

  // 筛选项从页面实际存在的分类生成
  const categoryFilters = useMemo(() => [
    { value: "all", label: "全部" },
    ...listWikiCategories(pages.map((p) => p.category)).map((c) => ({
      value: c,
      label: getCategoryView(c).label,
    })),
  ], [pages])

  const handleDelete = useCallback(async (filename: string) => {
    const res = await fetch(`/api/wiki?filename=${encodeURIComponent(filename)}`, { method: "DELETE" })
    if (res.ok) {
      setPages((prev) => prev.filter((e) => e.filename !== filename))
    }
    setConfirmDelete(null)
  }, [])

  const openCreateDialog = useCallback(() => {
    setFormName("")
    setFormDesc("")
    setFormCategory("domain")
    setFormContent("")
    setFormError(null)
    setDialogOpen(true)
  }, [])

  const handleCreate = useCallback(async () => {
    if (!formName.trim() || !formContent.trim()) {
      setFormError("名称和内容不能为空")
      return
    }
    setFormSaving(true)
    setFormError(null)
    try {
      const res = await fetch("/api/wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDesc.trim(),
          category: formCategory.trim() || undefined,
          content: formContent,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setFormError(data.error ?? "创建失败")
        return
      }
      await loadPages()
      setDialogOpen(false)
    } catch {
      setFormError("网络错误，请重试")
    } finally {
      setFormSaving(false)
    }
  }, [formName, formDesc, formCategory, formContent, loadPages])

  const handleLint = useCallback(async () => {
    setLintRunning(true)
    try {
      const res = await fetch("/api/wiki/lint", { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setLintReport(data.report ?? null)
        // 自动修复可能改动了索引，刷新列表
        await loadPages()
      }
    } finally {
      setLintRunning(false)
    }
  }, [loadPages])

  const handleToggleLog = useCallback(async () => {
    if (showLog) {
      setShowLog(false)
      return
    }
    setShowLog(true)
    setLogLoading(true)
    try {
      const res = await fetch("/api/wiki/log?limit=50")
      if (res.ok) {
        const data = await res.json()
        setLogEntries(data.entries ?? [])
      }
    } catch {
      setLogEntries([])
    } finally {
      setLogLoading(false)
    }
  }, [showLog])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={categoryFilter ?? "all"}
          onValueChange={(v) => setCategoryFilter(v === "all" ? null : v)}
        >
          <SelectTrigger className="w-25">
            <SelectValue placeholder="分类" />
          </SelectTrigger>
          <SelectContent>
            {categoryFilters.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center border rounded-md overflow-hidden">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-8 rounded-r-none",
              viewMode === "list"
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setViewMode("list")}
          >
            <ListIcon className="size-4" />
          </Button>
          <div className="w-px h-4 bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-8 rounded-l-none",
              viewMode === "graph"
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setViewMode("graph")}
          >
            <NetworkIcon className="size-4" />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLint} disabled={lintRunning} title="健康检查">
          {lintRunning
            ? <Loader2Icon className="size-4 animate-spin" />
            : <HeartPulseIcon className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleLog}
          title="操作日志"
          className={cn(showLog && "bg-accent")}
        >
          <ScrollTextIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={loadPages} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="sm" onClick={openCreateDialog}>
          <PlusIcon className="size-4 mr-1" />新建
        </Button>
      </div>

      {/* Lint report banner */}
      {lintReport && (
        <div className="shrink-0 px-6 py-2 border-b bg-muted/20 flex items-start gap-3">
          <div className="flex-1 min-w-0 text-xs space-y-1">
            <p className="text-muted-foreground">
              健康检查完成：检查 {lintReport.checked} 个页面，
              自动修复 {lintReport.fixed} 项，
              {lintReport.issues.length > 0 ? `发现 ${lintReport.issues.length} 个建议` : "没有发现问题"}
            </p>
            {lintReport.issues.slice(0, 5).map((issue, i) => (
              <p key={i} className="text-muted-foreground/80 truncate">
                <span className={cn(
                  "inline-block px-1 rounded text-[10px] mr-1.5",
                  issue.severity === "high" ? "bg-red-500/10 text-red-600 dark:text-red-400"
                    : issue.severity === "medium" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-muted text-muted-foreground",
                )}>{issue.type}</span>
                {issue.description}
              </p>
            ))}
            {lintReport.issues.length > 5 && (
              <p className="text-muted-foreground/60">… 另有 {lintReport.issues.length - 5} 个建议</p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => setLintReport(null)}>
            <XIcon className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Log timeline panel */}
      {showLog && (
        <div className="shrink-0 border-b bg-muted/10 max-h-64 overflow-y-auto px-6 py-3">
          {logLoading ? (
            <div className="flex items-center text-muted-foreground text-xs py-2">
              <Loader2Icon className="size-3.5 animate-spin mr-2" />
              加载日志...
            </div>
          ) : logEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">还没有操作日志。</p>
          ) : (
            <div className="space-y-2">
              {logEntries.map((entry, i) => (
                <div key={i} className="text-xs">
                  <p className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                      {entry.operation}
                    </span>
                    <span className="truncate">{entry.description}</span>
                    <span className="text-muted-foreground/50 text-[10px] ml-auto shrink-0">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </p>
                  {entry.details.length > 0 && (
                    <ul className="mt-0.5 ml-4 space-y-0.5 text-muted-foreground/70">
                      {entry.details.map((detail, j) => (
                        <li key={j} className="truncate">{detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : viewMode === "graph" ? (
          <div className="relative h-full min-h-125 -mx-6 -my-4">
            <WikiGraph
              onSelectPage={(filename) =>
                router.push(`/settings/wiki/${encodeURIComponent(filename)}`)
              }
              categoryFilter={categoryFilter}
              searchQuery={search}
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <BrainIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">
                {pages.length === 0 ? "暂无知识" : "没有匹配的知识"}
              </p>
              {pages.length === 0 && (
                <p className="text-xs">
                  点击「新建」创建知识条目，或在对话中自动学习
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
            {filtered.map((page) => (
              <WikiCard
                key={page.filename}
                page={page}
                onClick={() => router.push(`/settings/wiki/${encodeURIComponent(page.filename)}`)}
                onDelete={() => setConfirmDelete(page)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(null)}>
          <div
            className="bg-background rounded-lg border shadow-lg max-w-sm w-full mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">确认删除</h3>
              <p className="text-sm text-muted-foreground">
                确定要删除知识 &ldquo;{confirmDelete.name}&rdquo; 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(confirmDelete.filename)}>
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建知识</DialogTitle>
            <DialogDescription>创建一条新的知识条目到知识库</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="wiki-name">名称</Label>
              <Input id="wiki-name" placeholder="例如: 用户姓名" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wiki-desc">描述</Label>
              <Input id="wiki-desc" placeholder="一句话摘要（用于索引）" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wiki-category">分类</Label>
              <Input
                id="wiki-category"
                list="wiki-category-suggestions"
                placeholder="例如: domain（可自定义，留空归入 misc）"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
              />
              <datalist id="wiki-category-suggestions">
                <option value="user">用户（偏好、身份、习惯）</option>
                <option value="agent">Agent（行为规则）</option>
                <option value="project">项目（架构、选型、进度）</option>
                <option value="domain">领域（技术对比、最佳实践）</option>
                <option value="entity">实体（人物、工具、服务）</option>
              </datalist>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wiki-content">内容</Label>
              <Textarea id="wiki-content" placeholder="知识的正文内容..." rows={8} value={formContent} onChange={(e) => setFormContent(e.target.value)} className="font-mono text-sm" />
            </div>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={formSaving}>取消</Button>
            <Button onClick={handleCreate} disabled={formSaving}>{formSaving ? "创建中..." : "创建"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
