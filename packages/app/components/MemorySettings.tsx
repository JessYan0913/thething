import { useCallback, useEffect, useMemo, useState } from "react"
import {
  DatabaseIcon, RefreshCwIcon, SearchIcon,
  TrashIcon, CheckIcon, XIcon, FileTextIcon,
  UserIcon, ChevronRightIcon,
} from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

const typeLabels: Record<string, { label: string; color: string }> = {
  user: { label: "用户记忆", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25" },
  feedback: { label: "反馈记忆", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/25" },
  project: { label: "项目记忆", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25" },
  reference: { label: "参考记忆", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25" },
}

const typeOptions = [
  { value: null, label: "全部" },
  { value: "user", label: "用户" },
  { value: "feedback", label: "反馈" },
  { value: "project", label: "项目" },
  { value: "reference", label: "参考" },
]

export default function MemorySettings() {
  const [entries, setEntries] = useState<MemoryEntryView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeUser, setActiveUser] = useState<string | null>(null)
  const [selected, setSelected] = useState<MemoryEntryView | null>(null)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

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

  useEffect(() => { loadMemory() }, [loadMemory])

  // 用户目录列表（按条目数排序）
  const users = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      map.set(e.userId, (map.get(e.userId) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count }))
  }, [entries])

  // 自动选中第一个用户目录
  useEffect(() => {
    if (!isLoading && users.length > 0 && !activeUser) {
      setActiveUser(users[0].id)
    }
  }, [isLoading, users, activeUser])

  // 当前用户目录下的记忆 + 筛选
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
          e.description.toLowerCase().includes(q)
      )
    }
    return result
  }, [entries, activeUser, typeFilter, search])

  // 自动选中第一条
  useEffect(() => {
    if (isLoading || filtered.length === 0) {
      if (filtered.length === 0) setSelected(null)
      return
    }
    if (!selected || !filtered.some((e) => e.filePath === selected.filePath)) {
      setSelected(filtered[0])
    }
  }, [isLoading, filtered, selected])

  const handleDelete = useCallback(async (filePath: string) => {
    const res = await fetch(`/api/memory?filePath=${encodeURIComponent(filePath)}`, { method: "DELETE" })
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.filePath !== filePath))
      setSelected((prev) => (prev?.filePath === filePath ? null : prev))
    }
    setConfirmDelete(null)
  }, [])

  const getContentBody = (content: string) => {
    return content.replace(/^---[\s\S]*?---\s*/, "").trim() || content.trim()
  }

  const activeUserCount = activeUser ? entries.filter((e) => e.userId === activeUser).length : entries.length

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <DatabaseIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">记忆管理</span>
        <div className="flex items-center gap-2 ml-auto text-xs text-muted-foreground">
          <span>{entries.length} 条</span>
          <span>·</span>
          <span>{users.length} 个用户</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadMemory} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* 三栏主体 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左栏：用户目录 */}
        <div className="w-48 border-r overflow-auto shrink-0">
          <div className="px-3 py-2 border-b">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">用户目录</span>
          </div>
          {isLoading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">加载中...</div>
          ) : users.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">暂无记忆</div>
          ) : (
            <div className="py-1">
              {users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => { setActiveUser(u.id); setSelected(null); setSearch(""); setTypeFilter(null) }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                    activeUser === u.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <UserIcon className="size-3.5 shrink-0" />
                  <span className="text-sm truncate flex-1">{u.id}</span>
                  <span className="text-[10px] text-muted-foreground/50">{u.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 中栏：记忆列表 */}
        <div className="w-72 border-r overflow-auto shrink-0 flex flex-col">
          {/* 搜索 + 类型筛选 */}
          <div className="shrink-0 space-y-2 px-3 py-2.5 border-b">
            <div className="relative">
              <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
              <input
                type="text"
                placeholder="搜索..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-7 pl-7 pr-2 text-xs bg-background border rounded-md outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
              />
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {typeOptions.map((opt) => (
                <button
                  key={opt.value ?? "all"}
                  onClick={() => setTypeFilter(opt.value)}
                  className={cn(
                    "px-2 h-5 text-[10px] rounded transition-colors",
                    typeFilter === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-muted-foreground/40">
                {filtered.length} 条
              </span>
            </div>
          </div>
          {/* 列表 */}
          <div className="flex-1 overflow-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
                <FileTextIcon className="size-6 opacity-20" />
                <p className="text-xs">暂无记忆</p>
              </div>
            ) : (
              <div className="py-0.5">
                {filtered.map((entry, i) => {
                  const typeInfo = typeLabels[entry.type] ?? { label: entry.type, color: "" }
                  const isSelected = selected?.filePath === entry.filePath

                  return (
                    <button
                      key={i}
                      onClick={() => setSelected(entry)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                        isSelected
                          ? "bg-accent"
                          : "hover:bg-accent/50"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm truncate">{entry.name}</span>
                          <Badge className={`text-[9px] border-0 px-1 py-0 leading-tight ${typeInfo.color}`}>
                            {typeInfo.label}
                          </Badge>
                        </div>
                        {entry.description && (
                          <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5">
                            {entry.description}
                          </p>
                        )}
                      </div>
                      <ChevronRightIcon className="size-3 text-muted-foreground/30 shrink-0" />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右栏：内容预览 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <h2 className="text-sm font-semibold truncate">{selected.name}</h2>
                  {(() => {
                    const typeInfo = typeLabels[selected.type] ?? { label: selected.type, color: "" }
                    return <Badge className={`text-xs border-0 ${typeInfo.color}`}>{typeInfo.label}</Badge>
                  })()}
                  <span className="text-xs text-muted-foreground/40">@{selected.userId}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground/30 mr-2">
                    {selected.lines} 行 · {selected.sizeKb.toFixed(1)} KB
                  </span>
                  {confirmDelete === selected.filePath ? (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(selected.filePath)}>
                        <CheckIcon className="size-3 mr-1" />确认
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                        <XIcon className="size-3" />
                      </Button>
                    </div>
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="hover:text-destructive" onClick={() => setConfirmDelete(selected.filePath)}>
                            <TrashIcon className="size-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>删除后无法恢复</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-auto p-6">
                <pre className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap wrap-break-word font-sans">
                  {getContentBody(selected.content)}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground/30 text-sm">
              选择一条记忆以查看内容
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
