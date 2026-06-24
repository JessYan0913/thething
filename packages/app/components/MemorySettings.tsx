import { useCallback, useEffect, useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  SearchIcon, TrashIcon, CheckIcon, XIcon,
  PlusIcon, PencilIcon, RefreshCwIcon, BrainIcon,
  UserIcon, BotIcon, FolderIcon, GlobeIcon, BoxIcon,
  Loader2Icon, NetworkIcon, ListIcon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import WikiGraph from "@/components/WikiGraph"
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

const categoryFilters = [
  { value: null, label: "全部" },
  { value: "user", label: "用户" },
  { value: "agent", label: "Agent" },
  { value: "project", label: "项目" },
  { value: "domain", label: "领域" },
  { value: "entity", label: "实体" },
]

function getRelativeTime(dateStr: string) {
  const ageMs = Date.now() - new Date(dateStr).getTime()
  const ageDays = Math.floor(ageMs / 86400000)
  if (ageDays < 1) return "今天"
  if (ageDays < 30) return `${ageDays}天前`
  if (ageDays < 365) return `${Math.floor(ageDays / 30)}个月前`
  return `${Math.floor(ageDays / 365)}年前`
}

export default function MemorySettings() {
  const [pages, setPages] = useState<WikiPageView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [editSaving, setEditSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [viewMode, setViewMode] = useState<"list" | "graph">("list")

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
      const res = await fetch("/api/memory")
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

  const selectedPage = useMemo(
    () => pages.find((p) => p.filename === selectedFilename) ?? null,
    [pages, selectedFilename]
  )

  const handleSelectPage = useCallback((filename: string) => {
    setSelectedFilename(filename)
    setEditingId(null)
    setEditContent("")
    setConfirmDelete(false)
  }, [])

  const handleStartEdit = useCallback(() => {
    if (!selectedPage) return
    setEditingId(selectedPage.filename)
    setEditContent(selectedPage.content)
  }, [selectedPage])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditContent("")
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!selectedPage || !editContent.trim()) return
    setEditSaving(true)
    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selectedPage.filename,
          name: selectedPage.name,
          description: selectedPage.description,
          category: selectedPage.category,
          content: editContent.trim(),
        }),
      })
      if (res.ok) {
        await loadPages()
        setEditingId(null)
        setEditContent("")
      }
    } finally {
      setEditSaving(false)
    }
  }, [selectedPage, editContent, loadPages])

  const handleDelete = useCallback(async () => {
    if (!selectedPage) return
    const res = await fetch(`/api/memory?filename=${encodeURIComponent(selectedPage.filename)}`, { method: "DELETE" })
    if (res.ok) {
      setPages((prev) => prev.filter((e) => e.filename !== selectedPage.filename))
      setSelectedFilename(null)
    }
    setConfirmDelete(false)
  }, [selectedPage])

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
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDesc.trim(),
          category: formCategory,
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b bg-muted/30">
        <h1 className="text-sm font-semibold shrink-0">知识库</h1>
        <div className="flex-1" />
        <div className="relative w-52">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={loadPages} disabled={isLoading} className="h-7 px-2">
          <RefreshCwIcon className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <div className="flex items-center border rounded-md">
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
            className="h-7 px-2 rounded-r-none"
          >
            <ListIcon className="size-3.5" />
          </Button>
          <Button
            variant={viewMode === "graph" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("graph")}
            className="h-7 px-2 rounded-l-none"
          >
            <NetworkIcon className="size-3.5" />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={openCreateDialog} className="h-7 px-2">
          <PlusIcon className="size-3.5 mr-1" />新建
        </Button>
      </div>

      {/* 主体: 列表视图 或 图谱视图 */}
      {viewMode === "graph" ? (
        <div className="flex-1 min-h-0">
          <WikiGraph onSelectPage={(filename) => {
            setViewMode("list")
            setSelectedFilename(filename)
          }} />
        </div>
      ) : (
      <div className="flex flex-1 min-h-0">
        {/* 左侧目录 */}
        <div className="w-60 shrink-0 border-r flex flex-col min-h-0">
          {/* 分类筛选 */}
          <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b">
            {categoryFilters.map((opt) => (
              <button
                key={opt.value ?? "all"}
                onClick={() => setCategoryFilter(opt.value)}
                className={cn(
                  "px-2 py-1 text-[11px] rounded transition-colors",
                  categoryFilter === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 页面列表 */}
          <div className="flex-1 overflow-auto min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <BrainIcon className="size-6 opacity-20" />
                <p className="text-xs">{search ? "无匹配" : "暂无知识"}</p>
                {!search && (
                  <Button variant="outline" size="sm" onClick={openCreateDialog} className="h-6 text-xs">
                    <PlusIcon className="size-3 mr-1" />创建
                  </Button>
                )}
              </div>
            ) : (
              <div className="py-1">
                {filtered.map((page) => {
                  const config = categoryConfig[page.category]
                  const isSelected = selectedFilename === page.filename
                  return (
                    <button
                      key={page.filename}
                      onClick={() => handleSelectPage(page.filename)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50 text-foreground"
                      )}
                    >
                      {config && (
                        <span className={cn("shrink-0", config.color)}>{config.icon}</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{page.name}</div>
                        {page.description && (
                          <div className="text-[11px] text-muted-foreground truncate">{page.description}</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 底部计数 */}
          <div className="shrink-0 px-3 py-1.5 border-t text-[11px] text-muted-foreground/50">
            {filtered.length} 条知识
          </div>
        </div>

        {/* 右侧预览 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {!selectedPage ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <BrainIcon className="size-10 mx-auto opacity-20 mb-2" />
                <p className="text-sm">选择一个知识条目查看详情</p>
              </div>
            </div>
          ) : editingId === selectedPage.filename ? (
            /* 编辑模式 */
            <div className="flex flex-col h-full min-h-0 p-4 gap-3">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-medium">编辑: {selectedPage.name}</span>
                <span className="text-[11px] text-muted-foreground">{getRelativeTime(selectedPage.updated)}</span>
              </div>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="flex-1 min-h-0 text-sm font-mono resize-none"
                autoFocus
              />
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" onClick={handleSaveEdit} disabled={editSaving}>
                  {editSaving ? <Loader2Icon className="size-3.5 animate-spin mr-1" /> : <CheckIcon className="size-3.5 mr-1" />}
                  保存
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancelEdit}>取消</Button>
                <span className="text-[11px] text-muted-foreground/40 ml-2">Ctrl+S 保存</span>
              </div>
            </div>
          ) : (
            /* 预览模式 */
            <div className="flex flex-col h-full min-h-0">
              {/* 页头 */}
              <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{selectedPage.name}</span>
                    {categoryConfig[selectedPage.category] && (
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full",
                        selectedPage.category === "user" && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                        selectedPage.category === "agent" && "bg-purple-500/10 text-purple-600 dark:text-purple-400",
                        selectedPage.category === "project" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        selectedPage.category === "domain" && "bg-green-500/10 text-green-600 dark:text-green-400",
                        selectedPage.category === "entity" && "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
                      )}>
                        {categoryConfig[selectedPage.category].label}
                      </span>
                    )}
                  </div>
                  {selectedPage.description && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5">{selectedPage.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={handleStartEdit} className="h-7 px-2">
                    <PencilIcon className="size-3.5 mr-1" />编辑
                  </Button>
                  {confirmDelete ? (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={handleDelete}>
                        <CheckIcon className="size-3.5 mr-1" />确认
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirmDelete(false)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                      <TrashIcon className="size-3.5 mr-1" />删除
                    </Button>
                  )}
                </div>
              </div>

              {/* 内容 */}
              <div className="flex-1 overflow-auto min-h-0">
                <div className="prose prose-sm dark:prose-invert max-w-none p-4">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-4">
                          <table className="border-collapse border w-full text-sm">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => (
                        <thead className="border-b bg-muted/50">{children}</thead>
                      ),
                      tbody: ({ children }) => (
                        <tbody>{children}</tbody>
                      ),
                      tr: ({ children }) => (
                        <tr className="border-b hover:bg-muted/30">{children}</tr>
                      ),
                      th: ({ children }) => (
                        <th className="border px-3 py-2 text-left font-medium">{children}</th>
                      ),
                      td: ({ children }) => (
                        <td className="border px-3 py-2">{children}</td>
                      ),
                      h1: ({ children }) => (
                        <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-xl font-bold mt-5 mb-2">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-lg font-bold mt-4 mb-2">{children}</h3>
                      ),
                      p: ({ children }) => (
                        <p className="my-2 leading-relaxed">{children}</p>
                      ),
                      ul: ({ children }) => (
                        <ul className="list-disc ml-6 my-2">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal ml-6 my-2">{children}</ol>
                      ),
                      li: ({ children }) => (
                        <li className="my-1">{children}</li>
                      ),
                      code: ({ className, children }) => {
                        const isInline = !className;
                        if (isInline) {
                          return (
                            <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
                              {children}
                            </code>
                          );
                        }
                        return (
                          <code className={className}>{children}</code>
                        );
                      },
                      pre: ({ children }) => (
                        <pre className="rounded-md bg-muted p-4 overflow-x-auto my-4">
                          {children}
                        </pre>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-4 italic text-muted-foreground">
                          {children}
                        </blockquote>
                      ),
                      hr: () => (
                        <hr className="my-6 border-t" />
                      ),
                      a: ({ href, children }) => (
                        <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-bold">{children}</strong>
                      ),
                    }}
                  >
                    {selectedPage.content}
                  </ReactMarkdown>
                </div>
              </div>

              {/* 底部状态栏 */}
              <div className="shrink-0 px-4 py-1.5 border-t text-[11px] text-muted-foreground/40 flex items-center gap-3">
                <span>{selectedPage.lines} 行</span>
                <span>{selectedPage.sizeKb.toFixed(1)} KB</span>
                <span className="ml-auto">更新于 {getRelativeTime(selectedPage.updated)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* 创建对话框 */}
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
              <Label>分类</Label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">用户（偏好、身份、习惯）</SelectItem>
                  <SelectItem value="agent">Agent（行为规则）</SelectItem>
                  <SelectItem value="project">项目（架构、选型、进度）</SelectItem>
                  <SelectItem value="domain">领域（技术对比、最佳实践）</SelectItem>
                  <SelectItem value="entity">实体（人物、工具、服务）</SelectItem>
                </SelectContent>
              </Select>
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
