import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BotIcon, RefreshCwIcon, SearchIcon, SparklesIcon,
  PlusIcon, PencilIcon, TrashIcon, CheckIcon, XIcon,
  CpuIcon, WrenchIcon, ExternalLinkIcon,
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
}

const effortLabels: Record<string, string> = {
  low: "轻量",
  medium: "中等",
  high: "高开销",
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
    instructions: (agent as Record<string, unknown>).instructions as string ?? "",
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
          })}
          disabled={saving || !form.agentType || !form.description}
        >
          {saving ? "保存中..." : isEdit ? "保存" : "创建"}
        </Button>
      </DialogFooter>
    </div>
  )
}

export default function AgentsSettings() {
  const router = useRouter()
  const [agents, setAgents] = useState<AgentView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterModel, setFilterModel] = useState("all")
  const [filterSource, setFilterSource] = useState("all")
  const [filterEffort, setFilterEffort] = useState("all")
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
      await fetch(`/api/agents?agentType=${encodeURIComponent(agentType)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { enabled } }),
      })
    } catch {
      // Revert on error
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
    return agents.filter((a) => {
      if (search) {
        const q = search.toLowerCase()
        const name = (a.displayName ?? a.agentType).toLowerCase()
        const type = a.agentType.toLowerCase()
        const desc = (a.description ?? "").toLowerCase()
        if (!name.includes(q) && !type.includes(q) && !desc.includes(q)) return false
      }
      if (filterModel !== "all" && a.model !== filterModel) return false
      if (filterSource !== "all" && a.source !== filterSource) return false
      if (filterEffort !== "all" && a.effort !== filterEffort) return false
      return true
    })
  }, [agents, search, filterModel, filterSource, filterEffort])

  const stats = useMemo(() => {
    const bySource: Record<string, number> = {}
    for (const a of agents) {
      bySource[a.source] = (bySource[a.source] ?? 0) + 1
    }
    return { total: agents.length, bySource }
  }, [agents])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 border-b bg-muted/30 px-6 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索代理名称或描述..."
              className="h-8 pl-8 text-sm"
            />
          </div>
          <Select value={filterModel} onValueChange={setFilterModel}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有模型</SelectItem>
              <SelectItem value="inherit">继承</SelectItem>
              <SelectItem value="fast">快速</SelectItem>
              <SelectItem value="smart">智能</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有来源</SelectItem>
              <SelectItem value="builtin">内置</SelectItem>
              <SelectItem value="user">用户</SelectItem>
              <SelectItem value="project">项目</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterEffort} onValueChange={setFilterEffort}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="难度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有难度</SelectItem>
              <SelectItem value="low">轻量</SelectItem>
              <SelectItem value="medium">中等</SelectItem>
              <SelectItem value="high">高开销</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => router.push("/workbench/agent")}>
            <SparklesIcon className="size-3.5 mr-1" />
            AI 创建
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <PlusIcon className="size-3.5 mr-1" />
            手动创建
          </Button>
          <Button variant="ghost" size="sm" onClick={loadAgents} disabled={isLoading}>
            <RefreshCwIcon className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>代理总数: <span className="font-medium text-foreground">{stats.total}</span></span>
          {Object.entries(stats.bySource).map(([source, count]) => (
            <span key={source}>
              {sourceLabels[source] ?? source}: <span className="font-medium text-foreground">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto">
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-6 py-2.5 font-medium">状态</th>
                  <th className="text-left px-4 py-2.5 font-medium">名称</th>
                  <th className="text-left px-4 py-2.5 font-medium">模型</th>
                  <th className="text-center px-4 py-2.5 font-medium">工具</th>
                  <th className="text-left px-4 py-2.5 font-medium">难度</th>
                  <th className="text-center px-4 py-2.5 font-medium">轮次</th>
                  <th className="text-left px-4 py-2.5 font-medium">来源</th>
                  <th className="text-right px-6 py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((agent) => {
                  const enabled = agent.metadata?.enabled !== false
                  return (
                    <tr
                      key={agent.agentType}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      {/* Status toggle */}
                      <td className="px-6 py-3">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Switch
                                checked={enabled}
                                onCheckedChange={(v) => handleToggleEnabled(agent.agentType, v)}
                                disabled={agent.source === "builtin"}
                              />
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
                      </td>

                      {/* Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">
                              {agent.displayName ?? agent.agentType}
                            </div>
                            {agent.displayName && (
                              <div className="text-xs text-muted-foreground/60 font-mono truncate">
                                {agent.agentType}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Model */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-xs">
                          <CpuIcon className="size-3 text-muted-foreground" />
                          <span className="font-mono">
                            {modelLabels[agent.model ?? ""] ?? agent.model ?? "inherit"}
                          </span>
                        </div>
                      </td>

                      {/* Tools count */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                          <WrenchIcon className="size-3" />
                          <span>{agent.tools?.length ?? 0}</span>
                        </div>
                      </td>

                      {/* Effort */}
                      <td className="px-4 py-3">
                        {agent.effort && (
                          <Badge variant="outline" className="text-xs">
                            {effortLabels[agent.effort] ?? agent.effort}
                          </Badge>
                        )}
                      </td>

                      {/* Max turns */}
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                        {agent.maxTurns ?? "—"}
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={`text-xs ${sourceColors[agent.source] ?? ""}`}
                        >
                          {sourceLabels[agent.source] ?? agent.source}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => setEditingAgent(agent)}
                                >
                                  <PencilIcon className="size-3 mr-1" />
                                  编辑
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>编辑代理配置</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => router.push(`/workbench/agent/${agent.agentType}`)}
                                >
                                  <ExternalLinkIcon className="size-3 mr-1" />
                                  工作台
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>在 Agent 工作台中编辑</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          {agent.source !== "builtin" && (
                            confirmDelete === agent.agentType ? (
                              <div className="flex items-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  onClick={() => handleDelete(agent.agentType)}
                                >
                                  <CheckIcon className="size-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setConfirmDelete(null)}
                                >
                                  <XIcon className="size-3" />
                                </Button>
                              </div>
                            ) : (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 hover:text-destructive"
                                      onClick={() => setConfirmDelete(agent.agentType)}
                                    >
                                      <TrashIcon className="size-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>删除后无法恢复</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
    </div>
  )
}
