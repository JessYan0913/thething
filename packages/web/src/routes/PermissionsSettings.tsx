import { useCallback, useEffect, useState } from "react"
import { ShieldIcon, RefreshCwIcon, PlusIcon, TrashIcon, CheckIcon, XIcon, AlertCircleIcon, PencilIcon } from "lucide-react"
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

export default function PermissionsSettings() {
  const [rules, setRules] = useState<RuleView[]>([])
  const [isLoading, setIsLoading] = useState(true)
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
    if (!newToolName.trim()) return
    setAddError("")
    try {
      const res = await fetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: newToolName.trim(),
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
    if (!editingRule || !editToolName.trim()) return
    setEditError("")
    try {
      const res = await fetch(`/api/permissions?id=${encodeURIComponent(editingRule.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: editToolName.trim(),
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <Badge variant="secondary" className="text-xs">
          {rules.length} 条规则
        </Badge>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadRules} disabled={isLoading}>
            <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <PlusIcon className="size-4" />
            添加规则
          </Button>
        </div>
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
              <Input
                placeholder="例如: Bash, Read, Edit"
                value={newToolName}
                onChange={(e) => setNewToolName(e.target.value)}
              />
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
                <AlertCircleIcon className="size-4" />
                {addError}
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleAddRule} disabled={!newToolName.trim()}>
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
              <Input
                placeholder="例如: Bash, Read, Edit"
                value={editToolName}
                onChange={(e) => setEditToolName(e.target.value)}
              />
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
                <AlertCircleIcon className="size-4" />
                {editError}
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleUpdateRule} disabled={!editToolName.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <ShieldIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">暂无权限规则</p>
              <p className="text-xs">
                添加规则来控制 AI 代理对工具和资源的访问权限
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onDelete={() => handleDeleteRule(rule.id)}
                onEdit={() => openEditDialog(rule)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RuleRow({ rule, onDelete, onEdit }: { rule: RuleView; onDelete: () => void; onEdit: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="rounded-lg border px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <Badge className={`text-xs border-0 ${behaviorColors[rule.behavior]}`}>
          {behaviorLabels[rule.behavior]}
        </Badge>
        <span className="text-sm font-mono font-medium">{rule.toolName}</span>
        {rule.pattern && (
          <span className="text-xs text-muted-foreground font-mono truncate max-w-48">
            {rule.pattern}
          </span>
        )}
        {rule.source && (
          <Badge variant="outline" className="text-xs">{rule.source}</Badge>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <CheckIcon className="size-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              <XIcon className="size-3" />
            </Button>
          </div>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <PencilIcon className="size-3" />
            </Button>
            <Button variant="ghost" size="sm" className="hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <TrashIcon className="size-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
