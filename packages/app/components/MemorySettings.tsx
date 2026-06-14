import { useCallback, useEffect, useMemo, useState } from "react"
import {
  SearchIcon, TrashIcon, CheckIcon, XIcon,
  PlusIcon, PencilIcon, ChevronDownIcon, ChevronUpIcon,
  RefreshCwIcon, BrainIcon, UserIcon, MessageSquareIcon,
  FolderIcon, BookOpenIcon, Loader2Icon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface MemoryEntryView {
  name: string
  description: string
  type: string
  content: string
  filePath: string
  lines: number
  sizeKb: number
  userId: string
  mtimeMs: number
  source: string
  confidence: number
  validUntil: number | null
  supersededBy: string | null
}

const typeConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  user: { label: "关于我", icon: <UserIcon className="size-4" />, color: "text-blue-500" },
  feedback: { label: "反馈", icon: <MessageSquareIcon className="size-4" />, color: "text-purple-500" },
  project: { label: "项目", icon: <FolderIcon className="size-4" />, color: "text-amber-500" },
  reference: { label: "参考", icon: <BookOpenIcon className="size-4" />, color: "text-green-500" },
}

const typeFilters = [
  { value: null, label: "全部", icon: <BrainIcon className="size-3.5" /> },
  { value: "user", label: "关于我", icon: <UserIcon className="size-3.5" /> },
  { value: "feedback", label: "反馈", icon: <MessageSquareIcon className="size-3.5" /> },
  { value: "project", label: "项目", icon: <FolderIcon className="size-3.5" /> },
  { value: "reference", label: "参考", icon: <BookOpenIcon className="size-3.5" /> },
]

const DAY_MS = 24 * 60 * 60 * 1000

function getRelativeTime(mtimeMs: number) {
  const ageDays = Math.floor((Date.now() - mtimeMs) / DAY_MS)
  if (ageDays < 1) return "今天"
  if (ageDays < 7) return `${ageDays}天前`
  if (ageDays < 30) return `${ageDays}天前`
  if (ageDays < 365) return `${Math.floor(ageDays / 30)}个月前`
  return `${Math.floor(ageDays / 365)}年前`
}

function getContentPreview(content: string) {
  const body = content.replace(/^---[\s\S]*?---\s*/, "").trim()
  const firstLine = body.split("\n").find((l) => l.trim()) ?? ""
  return firstLine.length > 80 ? firstLine.slice(0, 80) + "..." : firstLine
}

function getContentBody(content: string) {
  return content.replace(/^---[\s\S]*?---\s*/, "").trim() || content.trim()
}

export default function MemorySettings() {
  const [entries, setEntries] = useState<MemoryEntryView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [editSaving, setEditSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [promotableCount, setPromotableCount] = useState(0)
  const [isPromoting, setIsPromoting] = useState(false)
  const [activeUser, setActiveUser] = useState<string | null>(null)

  // 创建对话框状态
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formName, setFormName] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formType, setFormType] = useState<string>("user")
  const [formContent, setFormContent] = useState("")
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadMemory = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/memory")
      if (res.ok) {
        const data = await res.json()
        setEntries(data.memory ?? [])
      }
    } catch {
      setEntries([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadUsage = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/memory/usage?userId=${encodeURIComponent(userId)}`)
      if (res.ok) {
        const data = await res.json()
        setPromotableCount(data.promotableCount ?? 0)
      }
    } catch {
      setPromotableCount(0)
    }
  }, [])

  const handleBatchPromote = useCallback(async () => {
    if (!activeUser || isPromoting) return
    setIsPromoting(true)
    try {
      const res = await fetch("/api/memory/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: activeUser }),
      })
      if (res.ok) {
        await loadMemory()
        await loadUsage(activeUser)
      }
    } finally {
      setIsPromoting(false)
    }
  }, [activeUser, isPromoting, loadMemory, loadUsage])

  useEffect(() => { loadMemory() }, [loadMemory])

  useEffect(() => {
    if (activeUser) loadUsage(activeUser)
  }, [activeUser, loadUsage])

  // 自动设置 activeUser
  useEffect(() => {
    if (!isLoading && entries.length > 0 && !activeUser) {
      const firstUser = entries[0]?.userId
      if (firstUser) setActiveUser(firstUser)
    }
  }, [isLoading, entries, activeUser])

  // 筛选逻辑
  const filtered = useMemo(() => {
    let result = entries
    if (activeUser) {
      result = result.filter((e) => e.userId === activeUser)
    }
    if (typeFilter) {
      result = result.filter((e) => e.type === typeFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          getContentBody(e.content).toLowerCase().includes(q)
      )
    }
    return result
  }, [entries, activeUser, typeFilter, search])

  const handleToggleExpand = useCallback((filePath: string) => {
    setExpandedId((prev) => (prev === filePath ? null : filePath))
    setEditingId(null)
    setConfirmDelete(null)
  }, [])

  const handleStartEdit = useCallback((entry: MemoryEntryView) => {
    setEditingId(entry.filePath)
    setEditContent(getContentBody(entry.content))
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditContent("")
  }, [])

  const handleSaveEdit = useCallback(async (entry: MemoryEntryView) => {
    if (!editContent.trim()) return
    setEditSaving(true)
    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: entry.filePath,
          name: entry.name,
          description: entry.description,
          type: entry.type,
          content: editContent.trim(),
        }),
      })
      if (res.ok) {
        const updatedContent = `---\nname: ${entry.name}\ndescription: ${entry.description}\ntype: ${entry.type}\n---\n\n${editContent.trim()}`
        const now = Date.now()
        setEntries((prev) =>
          prev.map((e) =>
            e.filePath === entry.filePath
              ? { ...e, content: updatedContent, mtimeMs: now, confidence: 0.9 }
              : e
          )
        )
        setEditingId(null)
        setEditContent("")
      }
    } finally {
      setEditSaving(false)
    }
  }, [editContent])

  const handleDelete = useCallback(async (filePath: string) => {
    const res = await fetch(`/api/memory?filePath=${encodeURIComponent(filePath)}`, { method: "DELETE" })
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.filePath !== filePath))
      if (expandedId === filePath) setExpandedId(null)
    }
    setConfirmDelete(null)
  }, [expandedId])

  const openCreateDialog = useCallback(() => {
    setFormName("")
    setFormDesc("")
    setFormType("user")
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
      const targetUserId = activeUser ?? entries[0]?.userId ?? "default"
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDesc.trim(),
          type: formType,
          content: formContent,
          userId: targetUserId,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setFormError(data.error ?? "创建失败")
        return
      }
      await loadMemory()
      setDialogOpen(false)
    } catch {
      setFormError("网络错误，请重试")
    } finally {
      setFormSaving(false)
    }
  }, [formName, formDesc, formType, formContent, activeUser, entries, loadMemory])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <h1 className="text-sm font-semibold shrink-0">我的记忆</h1>

        <div className="flex-1" />

        {searchOpen && (
          <div className="relative w-64">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="搜索记忆..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              autoFocus
            />
            {search && (
              <button
                onClick={() => { setSearch(""); setSearchOpen(false) }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {!searchOpen && (
          <Button variant="ghost" size="sm" onClick={() => setSearchOpen(true)}>
            <SearchIcon className="size-4" />
          </Button>
        )}

        <Button variant="ghost" size="sm" onClick={loadMemory} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>

        {promotableCount > 0 && (
          <Button variant="ghost" size="sm" onClick={handleBatchPromote} disabled={isPromoting}>
            <CheckIcon className="size-4 mr-1" />
            晋升 ({promotableCount})
          </Button>
        )}

        <Button variant="ghost" size="sm" onClick={openCreateDialog}>
          <PlusIcon className="size-4 mr-1" />新建
        </Button>
      </div>

      {/* 分类筛选 */}
      <div className="shrink-0 flex items-center gap-1 px-6 py-2 border-b">
        {typeFilters.map((opt) => (
          <button
            key={opt.value ?? "all"}
            onClick={() => setTypeFilter(opt.value)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors",
              typeFilter === opt.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground/50">
          {filtered.length} 条记忆
        </span>
      </div>

      {/* 卡片列表 */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin mr-2" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <BrainIcon className="size-10 opacity-20" />
            <p className="text-sm">{search ? "没有找到匹配的记忆" : "暂无记忆"}</p>
            {!search && (
              <Button variant="outline" size="sm" onClick={openCreateDialog}>
                <PlusIcon className="size-3.5 mr-1" />创建第一条记忆
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 max-w-2xl mx-auto">
            {filtered.map((entry) => {
              const config = typeConfig[entry.type] ?? { label: entry.type, icon: <BrainIcon className="size-4" />, color: "text-muted-foreground" }
              const isExpanded = expandedId === entry.filePath
              const isEditing = editingId === entry.filePath

              return (
                <div
                  key={entry.filePath}
                  className={cn(
                    "rounded-lg border transition-all",
                    isExpanded ? "bg-card shadow-sm" : "hover:border-accent/50 hover:bg-accent/20"
                  )}
                >
                  {/* 卡片头部 — 始终可见 */}
                  <button
                    onClick={() => handleToggleExpand(entry.filePath)}
                    className="w-full flex items-start gap-3 p-4 text-left"
                  >
                    <span className={cn("mt-0.5 shrink-0", config.color)}>
                      {config.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{entry.name}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {getRelativeTime(entry.mtimeMs)}
                        </span>
                      </div>
                      {entry.description && (
                        <p className="text-xs text-muted-foreground/60 mt-1 line-clamp-1">
                          {entry.description}
                        </p>
                      )}
                      {!isExpanded && (
                        <p className="text-xs text-muted-foreground/40 mt-1 line-clamp-1 font-mono">
                          {getContentPreview(entry.content)}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 mt-1 text-muted-foreground/30">
                      {isExpanded ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
                    </span>
                  </button>

                  {/* 展开内容 */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t">
                      <div className="pt-3">
                        {isEditing ? (
                          <div className="space-y-3">
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="min-h-50 text-sm font-mono resize-y"
                              autoFocus
                            />
                            <div className="flex items-center gap-2">
                              <Button size="sm" onClick={() => handleSaveEdit(entry)} disabled={editSaving}>
                                {editSaving ? (
                                  <Loader2Icon className="size-3.5 animate-spin mr-1" />
                                ) : (
                                  <CheckIcon className="size-3.5 mr-1" />
                                )}
                                保存
                              </Button>
                              <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                                取消
                              </Button>
                              <span className="text-[11px] text-muted-foreground/40 ml-2">
                                Ctrl+S 保存
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <pre className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap wrap-break-word font-sans">
                              {getContentBody(entry.content)}
                            </pre>
                            <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                              <Button size="sm" variant="ghost" onClick={() => handleStartEdit(entry)}>
                                <PencilIcon className="size-3.5 mr-1" />编辑
                              </Button>
                              {confirmDelete === entry.filePath ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => handleDelete(entry.filePath)}
                                  >
                                    <CheckIcon className="size-3.5 mr-1" />确认删除
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                                    取消
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => setConfirmDelete(entry.filePath)}
                                >
                                  <TrashIcon className="size-3.5 mr-1" />删除
                                </Button>
                              )}
                              <span className="ml-auto text-[11px] text-muted-foreground/30">
                                {config.label} · {entry.userId}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 创建对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建记忆</DialogTitle>
            <DialogDescription>创建一条新的记忆条目</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="mem-name">名称</Label>
              <Input
                id="mem-name"
                placeholder="例如: 前端开发偏好"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mem-desc">描述</Label>
              <Input
                id="mem-desc"
                placeholder="一句话描述（可选）"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>类型</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">关于我</SelectItem>
                  <SelectItem value="feedback">反馈</SelectItem>
                  <SelectItem value="project">项目</SelectItem>
                  <SelectItem value="reference">参考</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mem-content">内容</Label>
              <Textarea
                id="mem-content"
                placeholder="记忆的正文内容..."
                rows={8}
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={formSaving}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={formSaving}>
              {formSaving ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
