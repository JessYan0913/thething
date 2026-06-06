import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BotIcon, RefreshCwIcon, SearchIcon, SparklesIcon,
  PlusIcon, PencilIcon, TrashIcon, CheckIcon, XIcon,
  CpuIcon, WrenchIcon, ExternalLinkIcon, MoreVerticalIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip"

interface AgentView {
  agentType: string
  description: string
  displayName?: string
  tools?: string[]
  model?: string
  effort?: string
  maxTurns?: number
  permissionMode?: string
  background?: boolean
  memory?: string
  skills?: string[]
  source: string
  filePath?: string
  metadata?: Record<string, unknown>
  instructions?: string
}

const effortLabels: Record<string, string> = {
  low: "轻量",
  medium: "中等",
  high: "高开销",
}

const effortColors: Record<string, string> = {
  low: "bg-green-500/15 text-green-700 dark:text-green-400",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
}

const modelLabels: Record<string, string> = {
  inherit: "继承",
  fast: "快速",
  smart: "智能",
}

const sourceLabels: Record<string, string> = {
  builtin: "内置",
  user: "用户",
  project: "项目",
  plugin: "插件",
}

const sourceColors: Record<string, string> = {
  builtin: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  user: "bg-green-500/10 text-green-600 dark:text-green-400",
  project: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  plugin: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
}

// ============================================================
// AgentForm — 创建/编辑表单
// ============================================================

function AgentForm({
  agent,
  onSave,
  onCancel,
  saving,
}: {
  agent: Partial<AgentView>
  onSave: (data: Partial<AgentView>) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState({
    agentType: agent.agentType ?? "",
    displayName: agent.displayName ?? "",
    description: agent.description ?? "",
    model: agent.model ?? "inherit",
    effort: agent.effort ?? "medium",
    maxTurns: agent.maxTurns ?? 20,
    tools: (agent.tools ?? []).join(", "),
    skills: (agent.skills ?? []).join(", "),
    permissionMode: agent.permissionMode ?? "",
    memory: agent.memory ?? "",
    background: agent.background ?? false,
    instructions: agent.instructions ?? "",
  })

  const isEdit = !!agent.agentType

  return (
    <div className="space-y-4 max-h-[70vh] overflow-auto pr-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Agent ID *</Label>
          <Input
            value={form.agentType}
            onChange={(e) => setForm((p) => ({ ...p, agentType: e.target.value }))}
            placeholder="my-agent"
            disabled={isEdit}
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">显示名称</Label>
          <Input
            value={form.displayName}
            onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
            placeholder="我的代理"
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">描述 *</Label>
        <Input
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          placeholder="代理的功能描述"
          className="h-8 text-sm"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">模型</Label>
          <Select value={form.model} onValueChange={(v) => setForm((p) => ({ ...p, model: v }))}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">继承</SelectItem>
              <SelectItem value="fast">快速</SelectItem>
              <SelectItem value="smart">智能</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">难度</Label>
          <Select value={form.effort} onValueChange={(v) => setForm((p) => ({ ...p, effort: v }))}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">轻量</SelectItem>
              <SelectItem value="medium">中等</SelectItem>
              <SelectItem value="high">高开销</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">最大轮次</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={form.maxTurns}
            onChange={(e) => setForm((p) => ({ ...p, maxTurns: Number(e.target.value) || 20 }))}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">工具（逗号分隔）</Label>
          <Input
            value={form.tools}
            onChange={(e) => setForm((p) => ({ ...p, tools: e.target.value }))}
            placeholder="read_file, grep, glob"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">技能（逗号分隔）</Label>
          <Input
            value={form.skills}
            onChange={(e) => setForm((p) => ({ ...p, skills: e.target.value }))}
            placeholder="skill-a, skill-b"
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">权限模式</Label>
          <Select
            value={form.permissionMode}
            onValueChange={(v) => setForm((p) => ({ ...p, permissionMode: v }))}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="默认" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="acceptEdits">接受编辑</SelectItem>
              <SelectItem value="plan">计划模式</SelectItem>
              <SelectItem value="bypassPermissions">绕过权限</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">记忆范围</Label>
          <Select
            value={form.memory}
            onValueChange={(v) => setForm((p) => ({ ...p, memory: v }))}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="默认" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">用户级</SelectItem>
              <SelectItem value="project">项目级</SelectItem>
              <SelectItem value="local">本地</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={form.background}
          onCheckedChange={(v) => setForm((p) => ({ ...p, background: v }))}
        />
        <Label className="text-xs">后台运行</Label>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">系统指令（Markdown）</Label>
        <Textarea
          value={form.instructions}
          onChange={(e) => setForm((p) => ({ ...p, instructions: e.target.value }))}
          placeholder="# Agent 系统指令&#10;&#10;定义代理的行为规则..."
          rows={6}
          className="text-sm font-mono resize-y"
        />
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
        <Button
          size="sm"
          onClick={() => onSave({
            agentType: form.agentType,
            displayName: form.displayName,
            description: form.description,
            model: form.model,
            effort: form.effort,
            maxTurns: form.maxTurns,
            tools: form.tools.split(",").map((s) => s.trim()).filter(Boolean),
            skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
            permissionMode: form.permissionMode || undefined,
            memory: form.memory || undefined,
            background: form.background,
            instructions: form.instructions,
          })}
          disabled={saving || !form.agentType || !form.description}
        >
          {saving ? "保存中..." : isEdit ? "保存" : "创建"}
        </Button>
      </DialogFooter>
    </div>
  )
}

// ============================================================
// AgentCard — 代理列表卡片
// ============================================================

function AgentCard({
  agent,
  onEdit,
  onDelete,
  onToggleEnabled,
  onOpenWorkbench,
}: {
  agent: AgentView
  onEdit: () => void
  onDelete: () => void
  onToggleEnabled: (enabled: boolean) => void
  onOpenWorkbench: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const enabled = agent.metadata?.enabled !== false

  return (
    <div className={`rounded-lg border p-4 space-y-3 w-full transition-colors relative ${
      enabled
        ? "hover:border-accent/50 hover:bg-accent/20"
        : "opacity-60 border-dashed"
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <BotIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">
                {agent.displayName ?? agent.agentType}
              </span>
              <Badge
                className={`text-xs border-0 ${
                  enabled
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
              >
                {enabled ? "已启用" : "已禁用"}
              </Badge>
              {agent.effort && (
                <Badge
                  className={`text-xs border-0 ${effortColors[agent.effort] ?? effortColors.medium}`}
                >
                  {effortLabels[agent.effort] ?? agent.effort}
                </Badge>
              )}
              <Badge
                variant="secondary"
                className={`text-xs ${sourceColors[agent.source] ?? ""}`}
              >
                {sourceLabels[agent.source] ?? agent.source}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {agent.description}
            </p>
            {agent.displayName && (
              <p className="text-xs text-muted-foreground/60 font-mono">
                {agent.agentType}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="relative shrink-0 flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={agent.source === "builtin"}
                  onClick={() => onToggleEnabled(!enabled)}
                  className={`
                    relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent
                    transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    focus-visible:ring-offset-2 focus-visible:ring-offset-background
                    disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer
                    ${enabled ? "bg-primary" : "bg-input"}
                  `}
                >
                  <span
                    className={`
                      pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0
                      transition-transform
                      ${enabled ? "translate-x-5" : "translate-x-1"}
                    `}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {agent.source === "builtin"
                  ? "内置代理无法禁用"
                  : enabled
                    ? "点击禁用"
                    : "点击启用"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-xs text-muted-foreground select-none">
            {enabled ? "启用" : "禁用"}
          </span>

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
              <div className="absolute right-0 top-8 z-50 w-40 rounded-md border bg-popover shadow-md">
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent cursor-pointer rounded-md"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onOpenWorkbench()
                  }}
                >
                  <ExternalLinkIcon className="size-3.5" />
                  工作台
                </button>
                {agent.source !== "builtin" && (
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
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <CpuIcon className="size-3" />
          <span className="font-mono">
            {modelLabels[agent.model ?? ""] ?? agent.model ?? "inherit"}
          </span>
        </div>
        <span className="text-muted-foreground/40">|</span>
        <div className="flex items-center gap-1">
          <WrenchIcon className="size-3" />
          <span>{agent.tools?.length ?? 0} 个工具</span>
        </div>
        <span className="text-muted-foreground/40">|</span>
        <span>{agent.maxTurns ?? 20} 轮次</span>
      </div>
    </div>
  )
}

// ============================================================
// AgentsSettings — 主组件
// ============================================================

export default function AgentsSettings() {
  const router = useRouter()
  const [agents, setAgents] = useState<AgentView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentView | null>(null)
  const [saving, setSaving] = useState(false)

  const loadAgents = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/agents")
      if (res.ok) {
        const data = await res.json()
        setAgents(data.agents ?? [])
      }
    } catch {
      setAgents([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadAgents() }, [loadAgents])

  const handleToggleEnabled = useCallback(async (agentType: string, enabled: boolean) => {
    setAgents((prev) => prev.map((a) =>
      a.agentType === agentType
        ? { ...a, metadata: { ...a.metadata, enabled } }
        : a,
    ))
    try {
      const res = await fetch(`/api/agents?agentType=${encodeURIComponent(agentType)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { enabled } }),
      })
      if (!res.ok) {
        throw new Error("Failed to toggle agent")
      }
    } catch {
      setAgents((prev) => prev.map((a) =>
        a.agentType === agentType
          ? { ...a, metadata: { ...a.metadata, enabled: !enabled } }
          : a,
      ))
    }
  }, [])

  const handleDelete = useCallback(async (agentType: string) => {
    const res = await fetch(`/api/agents?agentType=${encodeURIComponent(agentType)}`, { method: "DELETE" })
    if (res.ok) {
      setAgents((prev) => prev.filter((a) => a.agentType !== agentType))
    }
    setConfirmDelete(null)
  }, [])

  const handleCreate = useCallback(async (data: Partial<AgentView>) => {
    setSaving(true)
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        setShowCreateDialog(false)
        loadAgents()
      }
    } finally {
      setSaving(false)
    }
  }, [loadAgents])

  const handleEdit = useCallback(async (data: Partial<AgentView>) => {
    if (!editingAgent) return
    setSaving(true)
    try {
      const res = await fetch(`/api/agents?agentType=${encodeURIComponent(editingAgent.agentType)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        setEditingAgent(null)
        loadAgents()
      }
    } finally {
      setSaving(false)
    }
  }, [editingAgent, loadAgents])

  const filteredAgents = useMemo(() => {
    if (!search) return agents
    const q = search.toLowerCase()
    return agents.filter((a) => {
      const name = (a.displayName ?? a.agentType).toLowerCase()
      const type = a.agentType.toLowerCase()
      const desc = (a.description ?? "").toLowerCase()
      return name.includes(q) || type.includes(q) || desc.includes(q)
    })
  }, [agents, search])

  const deleteTarget = confirmDelete ? agents.find((a) => a.agentType === confirmDelete) : null

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <Badge variant="secondary" className="text-xs px-2 py-0.5">
          {agents.length}
        </Badge>
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索代理..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={loadAgents} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => router.push("/workbench/agent")}>
          <SparklesIcon className="mr-1 size-4" />
          AI 创建
        </Button>
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <PlusIcon className="mr-1 size-4" />
          手动创建
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <BotIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">
                {agents.length === 0 ? "暂无代理" : "没有匹配的代理"}
              </p>
              {agents.length === 0 && (
                <p className="text-xs">
                  点击「AI 创建」通过对话创建代理，或「手动创建」填写表单
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredAgents.map((agent) => (
              <AgentCard
                key={agent.agentType}
                agent={agent}
                onEdit={() => setEditingAgent(agent)}
                onDelete={() => setConfirmDelete(agent.agentType)}
                onToggleEnabled={(v) => handleToggleEnabled(agent.agentType, v)}
                onOpenWorkbench={() => router.push(`/workbench/agent/${agent.agentType}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BotIcon className="size-4" />
              创建代理
            </DialogTitle>
          </DialogHeader>
          <AgentForm
            agent={{}}
            onSave={handleCreate}
            onCancel={() => setShowCreateDialog(false)}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingAgent} onOpenChange={(v) => { if (!v) setEditingAgent(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PencilIcon className="size-4" />
              编辑代理
              {editingAgent && (
                <Badge variant="secondary" className="text-xs font-mono ml-1">
                  {editingAgent.agentType}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {editingAgent && (
            <AgentForm
              agent={editingAgent}
              onSave={handleEdit}
              onCancel={() => setEditingAgent(null)}
              saving={saving}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(null)}>
          <div
            className="bg-background rounded-lg border shadow-lg max-w-sm w-full mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">确认删除</h3>
              <p className="text-sm text-muted-foreground">
                确定要删除代理 "{deleteTarget.displayName ?? deleteTarget.agentType}" 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDelete(deleteTarget.agentType)}
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
