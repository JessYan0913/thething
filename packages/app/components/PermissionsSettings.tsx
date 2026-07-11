import { useCallback, useEffect, useMemo, useState } from "react"
import { ShieldIcon, RefreshCwIcon, PlusIcon, TrashIcon, MoreVerticalIcon, PencilIcon, SearchIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface RuleView {
  id: string
  toolName: string
  pattern?: string
  behavior: "allow" | "ask" | "deny"
  createdAt: number
  source?: string
}

const behaviorLabels: Record<string, string> = {
  allow: "允许",
  ask: "询问",
  deny: "拒绝",
}

const behaviorColors: Record<string, string> = {
  allow: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25",
  ask: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/25",
  deny: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25",
}

// 支持权限控制的内置工具
const builtinTools = [
  { name: "bash", label: "Bash", description: "执行 shell 命令，pattern 匹配命令前缀" },
  { name: "read_file", label: "Read File", description: "读取文件，pattern 匹配文件路径" },
  { name: "edit_file", label: "Edit File", description: "编辑文件，pattern 匹配文件路径" },
  { name: "write_file", label: "Write File", description: "写入文件，pattern 匹配文件路径" },
  { name: "ask_user_question", label: "Ask User", description: "询问用户问题（强制需审批）" },
  { name: "*", label: "*（所有工具）", description: "通配符，匹配所有工具" },
]

const toolLabels: Record<string, string> = Object.fromEntries(
  builtinTools.map(t => [t.name, t.label])
)

// ============================================================
// RuleCard — 卡片组件
// ============================================================

function RuleCard({
  rule,
  onDelete,
  onEdit,
}: {
  rule: RuleView
  onDelete: () => void
  onEdit: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="rounded-lg border p-4 transition-colors hover:border-accent/50 hover:bg-accent/20 relative">
      <div className="flex items-start justify-between gap-4 min-w-0">
        <button
          onClick={onEdit}
          className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer"
        >
          <ShieldIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <Badge className={`text-xs border-0 ${behaviorColors[rule.behavior]}`}>
                {behaviorLabels[rule.behavior]}
              </Badge>
              <span className="font-medium text-sm font-mono">
                {toolLabels[rule.toolName] || rule.toolName}
              </span>
              {rule.source && (
                <Badge variant="outline" className="text-xs">{rule.source}</Badge>
              )}
            </div>
            {rule.pattern && (
              <p className="text-xs text-muted-foreground font-mono">
                模式: {rule.pattern}
              </p>
            )}
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent cursor-pointer rounded-md"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onEdit()
                  }}
                >
                  <PencilIcon className="size-3.5" />
                  编辑
                </button>
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
// PermissionsSettings — 主组件
// ============================================================

export default function PermissionsSettings() {
  const [rules, setRules] = useState<RuleView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newToolName, setNewToolName] = useState("")
  const [newPattern, setNewPattern] = useState("")
  const [newBehavior, setNewBehavior] = useState<"allow" | "ask" | "deny">("ask")
  const [addError, setAddError] = useState("")

  // 编辑状态
  const [editingRule, setEditingRule] = useState<RuleView | null>(null)
  const [editToolName, setEditToolName] = useState("")
  const [editPattern, setEditPattern] = useState("")
  const [editBehavior, setEditBehavior] = useState<"allow" | "ask" | "deny">("ask")
  const [editError, setEditError] = useState("")

  // 删除确认
  const [confirmDelete, setConfirmDelete] = useState<RuleView | null>(null)

  const loadRules = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/permissions")
      if (res.ok) {
        const data = await res.json()
        setRules(data.rules ?? [])
      }
    } catch {
      setRules([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  const handleAddRule = useCallback(async () => {
    if (!newToolName) return
    setAddError("")
    try {
      const res = await fetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: newToolName,
          pattern: newPattern.trim() || undefined,
          behavior: newBehavior,
        }),
      })
      if (res.ok) {
        setShowAddDialog(false)
        setNewToolName("")
        setNewPattern("")
        setNewBehavior("ask")
        await loadRules()
      } else {
        const data = await res.json()
        setAddError(data.error ?? "添加失败")
      }
    } catch {
      setAddError("网络错误")
    }
  }, [newToolName, newPattern, newBehavior, loadRules])

  const handleDeleteRule = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/permissions?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id))
      }
    } catch { /* ignore */ }
    setConfirmDelete(null)
  }, [])

  // 打开编辑对话框
  const openEditDialog = useCallback((rule: RuleView) => {
    setEditingRule(rule)
    setEditToolName(rule.toolName)
    setEditPattern(rule.pattern ?? "")
    setEditBehavior(rule.behavior)
    setEditError("")
  }, [])

  // 更新规则
  const handleUpdateRule = useCallback(async () => {
    if (!editingRule || !editToolName) return
    setEditError("")
    try {
      const res = await fetch(`/api/permissions?id=${encodeURIComponent(editingRule.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: editToolName,
          pattern: editPattern.trim() || undefined,
          behavior: editBehavior,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setRules((prev) =>
          prev.map((r) => r.id === editingRule.id ? data.rule : r)
        )
        setEditingRule(null)
        setEditToolName("")
        setEditPattern("")
        setEditBehavior("ask")
      } else {
        const data = await res.json()
        setEditError(data.error ?? "更新失败")
      }
    } catch {
      setEditError("网络错误")
    }
  }, [editingRule, editToolName, editPattern, editBehavior])

  const filteredRules = useMemo(() => {
    if (!search) return rules
    const q = search.toLowerCase()
    return rules.filter((r) => {
      const tool = (toolLabels[r.toolName] || r.toolName).toLowerCase()
      const pattern = (r.pattern ?? "").toLowerCase()
      const source = (r.source ?? "").toLowerCase()
      return tool.includes(q) || pattern.includes(q) || source.includes(q)
    })
  }, [rules, search])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索权限规则..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={loadRules} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <PlusIcon className="size-4" />
          添加规则
        </Button>
      </div>

      {/* Add Rule Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加权限规则</DialogTitle>
            <DialogDescription>
              设置工具调用的权限行为。支持 glob 模式匹配。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">工具名称</label>
              <Select value={newToolName} onValueChange={setNewToolName}>
                <SelectTrigger>
                  <SelectValue placeholder="选择工具" />
                </SelectTrigger>
                <SelectContent>
                  {builtinTools.map((tool) => (
                    <SelectItem key={tool.name} value={tool.name}>
                      <div className="flex flex-col">
                        <span>{tool.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {newToolName && (
                <p className="text-xs text-muted-foreground">
                  {builtinTools.find(t => t.name === newToolName)?.description}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">路径模式（可选）</label>
              <Input
                placeholder="例如: src/**, *.ts"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">行为</label>
              <Select value={newBehavior} onValueChange={(v: "allow" | "ask" | "deny") => setNewBehavior(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">允许（allow）</SelectItem>
                  <SelectItem value="ask">询问（ask）</SelectItem>
                  <SelectItem value="deny">拒绝（deny）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                {addError}
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleAddRule} disabled={!newToolName}>
              <PlusIcon className="size-4" />
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Rule Dialog */}
      <Dialog open={editingRule !== null} onOpenChange={(open) => !open && setEditingRule(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑权限规则</DialogTitle>
            <DialogDescription>
              修改工具调用的权限设置。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">工具名称</label>
              <Select value={editToolName} onValueChange={setEditToolName}>
                <SelectTrigger>
                  <SelectValue placeholder="选择工具" />
                </SelectTrigger>
                <SelectContent>
                  {builtinTools.map((tool) => (
                    <SelectItem key={tool.name} value={tool.name}>
                      <div className="flex flex-col">
                        <span>{tool.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editToolName && (
                <p className="text-xs text-muted-foreground">
                  {builtinTools.find(t => t.name === editToolName)?.description}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">路径模式（可选）</label>
              <Input
                placeholder="例如: src/**, *.ts"
                value={editPattern}
                onChange={(e) => setEditPattern(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">行为</label>
              <Select value={editBehavior} onValueChange={(v: "allow" | "ask" | "deny") => setEditBehavior(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">允许（allow）</SelectItem>
                  <SelectItem value="ask">询问（ask）</SelectItem>
                  <SelectItem value="deny">拒绝（deny）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                {editError}
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleUpdateRule} disabled={!editToolName}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                确定要删除权限规则 &ldquo;{toolLabels[confirmDelete.toolName] || confirmDelete.toolName}&rdquo; 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDeleteRule(confirmDelete.id)}>
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <ShieldIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">
                {rules.length === 0 ? "暂无权限规则" : "没有匹配的规则"}
              </p>
              {rules.length === 0 && (
                <p className="text-xs">
                  添加规则来控制 AI 代理对工具和资源的访问权限
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
            {filteredRules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onDelete={() => setConfirmDelete(rule)}
                onEdit={() => openEditDialog(rule)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
