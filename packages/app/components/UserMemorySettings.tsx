'use client';

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  TrashIcon, PlusIcon, RefreshCwIcon, SparklesIcon,
  MoreVerticalIcon, Loader2Icon, PinIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

interface MemoryView {
  id: string
  content: string
  type: string
  dimension?: string
  source?: string
  importance?: number
  pinned: boolean
  created: string
  updated: string
}

const TYPE_META: Record<string, { label: string; chip: string }> = {
  preference: { label: "偏好", chip: "bg-blue-500/10 text-blue-500" },
  identity: { label: "身份", chip: "bg-purple-500/10 text-purple-500" },
  correction: { label: "纠正", chip: "bg-amber-500/10 text-amber-500" },
  explicit: { label: "显式", chip: "bg-green-500/10 text-green-500" },
}

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? { label: type, chip: "bg-slate-500/10 text-slate-500" }
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
// 单条记忆卡片
// ============================================================

function MemoryCard({
  memory,
  onEdit,
  onDelete,
}: {
  memory: MemoryView
  onEdit: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const meta = getTypeMeta(memory.type)

  return (
    <div className="rounded-lg border p-4 transition-colors hover:border-accent/50 hover:bg-accent/20">
      <div className="flex items-start justify-between gap-4 min-w-0">
        <div className="min-w-0 space-y-1 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", meta.chip)}>
              {meta.label}
            </span>
            {memory.dimension && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-500/10 text-slate-500">
                {memory.dimension}
              </span>
            )}
            {memory.pinned && <PinIcon className="size-3 text-amber-500" />}
            {memory.importance !== undefined && (
              <span className="text-[10px] text-muted-foreground/60">重要度 {memory.importance}</span>
            )}
            <span className="text-[10px] text-muted-foreground/60">
              更新于 {getRelativeTime(memory.updated)}
            </span>
          </div>
          <p className="text-sm">{memory.content}</p>
          {memory.source && (
            <p className="text-xs text-muted-foreground/70 line-clamp-1">来源：{memory.source}</p>
          )}
        </div>

        <div className="relative shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
          >
            <MoreVerticalIcon className="size-4" />
          </Button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-50 w-32 rounded-md border bg-popover shadow-md">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50 cursor-pointer rounded-t-md"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit() }}
                >
                  编辑
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 cursor-pointer rounded-b-md"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
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
// UserMemorySettings — 主组件
// ============================================================

export default function UserMemorySettings() {
  const [memories, setMemories] = useState<MemoryView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  // 新增 / 编辑
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MemoryView | null>(null)
  const [formContent, setFormContent] = useState("")
  const [formType, setFormType] = useState("preference")
  const [formDimension, setFormDimension] = useState("")
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // 删除
  const [deleteTarget, setDeleteTarget] = useState<MemoryView | null>(null)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  // 冷启动提取
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<string | null>(null)

  const loadMemories = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/memory")
      if (res.ok) {
        const data = await res.json()
        setMemories(data.memories ?? [])
      }
    } catch {
      setMemories([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadMemories() }, [loadMemories])

  const filtered = useMemo(() => {
    let result = memories
    if (typeFilter) result = result.filter((m) => m.type === typeFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((m) =>
        m.content.toLowerCase().includes(q) ||
        (m.dimension ?? "").toLowerCase().includes(q) ||
        (m.source ?? "").toLowerCase().includes(q)
      )
    }
    return result
  }, [memories, typeFilter, search])

  const handleDelete = useCallback(async (memory: MemoryView) => {
    const res = await fetch(`/api/memory?id=${memory.id}`, { method: "DELETE" })
    if (res.ok) setMemories((prev) => prev.filter((m) => m.id !== memory.id))
    setDeleteTarget(null)
  }, [])

  const handleClearAll = useCallback(async () => {
    const res = await fetch("/api/memory?all=true", { method: "DELETE" })
    if (res.ok) setMemories([])
    setConfirmClearAll(false)
  }, [])

  const openCreate = useCallback(() => {
    setEditing(null)
    setFormContent("")
    setFormType("preference")
    setFormDimension("")
    setFormError(null)
    setDialogOpen(true)
  }, [])

  const openEdit = useCallback((memory: MemoryView) => {
    setEditing(memory)
    setFormContent(memory.content)
    setFormType(memory.type)
    setFormDimension(memory.dimension ?? "")
    setFormError(null)
    setDialogOpen(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!formContent.trim()) { setFormError("内容不能为空"); return }
    setFormSaving(true)
    setFormError(null)
    try {
      const method = editing ? "PUT" : "POST"
      const body = editing
        ? { id: editing.id, content: formContent.trim() }
        : {
            content: formContent.trim(),
            type: formType,
            dimension: formDimension.trim() || undefined,
          }
      const res = await fetch("/api/memory", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setDialogOpen(false)
        await loadMemories()
      } else {
        const data = await res.json()
        setFormError(data.error ?? "保存失败")
      }
    } catch {
      setFormError("保存失败")
    } finally {
      setFormSaving(false)
    }
  }, [editing, formContent, formType, formDimension, loadMemories])

  const handleExtract = useCallback(async () => {
    setExtracting(true)
    setExtractResult(null)
    try {
      const res = await fetch("/api/memory/extract", { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setExtractResult(`已从 ${data.conversationsScanned ?? 0} 个会话提取 ${data.extracted ?? 0} 条记忆${data.skipped ? `（跳过 ${data.skipped} 条重复）` : ""}`)
        await loadMemories()
      } else {
        const data = await res.json()
        setExtractResult(data.error ?? "提取失败")
      }
    } catch {
      setExtractResult("提取失败")
    } finally {
      setExtracting(false)
    }
  }, [loadMemories])

  const typeFilters = useMemo(() => [
    { value: null, label: "全部" },
    ...Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label })),
  ], [])

  return (
    <div className="flex flex-col flex-1 min-w-0 p-4 gap-4 overflow-y-auto">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="搜索记忆..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={typeFilter ?? "all"} onValueChange={(v) => setTypeFilter(v === "all" ? null : v)}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            {typeFilters.map((f) => (
              <SelectItem key={f.value ?? "all"} value={f.value ?? "all"}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={handleExtract} disabled={extracting}>
          {extracting ? <Loader2Icon className="size-3.5 animate-spin" /> : <SparklesIcon className="size-3.5" />}
          从历史对话提取
        </Button>
        <Button variant="ghost" size="icon" onClick={loadMemories} className="size-8">
          <RefreshCwIcon className="size-4" />
        </Button>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="size-3.5" />
          新增记忆
        </Button>
      </div>

      {/* 提取结果提示 */}
      {extractResult && (
        <div className="rounded-md border bg-accent/20 px-3 py-2 text-xs text-muted-foreground">
          {extractResult}
        </div>
      )}

      {/* 列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Loader2Icon className="size-4 animate-spin mr-2" /> 加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">{memories.length === 0 ? "还没有记忆。和助手对话时，偏好、身份、行为纠正会自动记住。" : "没有匹配的记忆"}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={handleExtract} disabled={extracting}>
            从历史对话提取
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <MemoryCard
              key={m.id}
              memory={m}
              onEdit={() => openEdit(m)}
              onDelete={() => setDeleteTarget(m)}
            />
          ))}
        </div>
      )}

      {/* 底部操作：清空 */}
      {memories.length > 0 && (
        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmClearAll(true)}>
            <TrashIcon className="size-3.5" />
            清空全部记忆
          </Button>
        </div>
      )}

      {/* 新增/编辑 Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑记忆" : "新增记忆"}</DialogTitle>
            <DialogDescription>
              记忆内容应短且具体，描述用户的稳定事实。敏感信息（密码、证件号等）不要保存。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>内容</Label>
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="如：不喜欢看表格，回复用文字"
                rows={3}
              />
            </div>
            {!editing && (
              <>
                <div className="space-y-1.5">
                  <Label>类型</Label>
                  <Select value={formType} onValueChange={setFormType}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preference">偏好</SelectItem>
                      <SelectItem value="identity">身份</SelectItem>
                      <SelectItem value="correction">行为纠正</SelectItem>
                      <SelectItem value="explicit">显式记忆</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>语义域（可选，单值属性用）</Label>
                  <Input
                    value={formDimension}
                    onChange={(e) => setFormDimension(e.target.value)}
                    placeholder="如：display-format、language"
                  />
                </div>
              </>
            )}
            {formError && <p className="text-xs text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={formSaving}>
              {formSaving && <Loader2Icon className="size-3.5 animate-spin mr-1" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 单条删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除记忆</DialogTitle>
            <DialogDescription>
              确定删除这条记忆吗？删除后不可恢复。
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <p className="text-sm rounded-md border bg-accent/20 px-3 py-2 line-clamp-2">
              {deleteTarget.content}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => deleteTarget && handleDelete(deleteTarget)}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 清空全部确认 */}
      <Dialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>清空全部记忆</DialogTitle>
            <DialogDescription>
              将删除全部 {memories.length} 条记忆，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClearAll(false)}>取消</Button>
            <Button variant="destructive" onClick={handleClearAll}>清空</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
