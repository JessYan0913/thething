import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BotIcon, RefreshCwIcon, SearchIcon, SparklesIcon,
  PlusIcon, PencilIcon, TrashIcon,
  ExternalLinkIcon, MoreVerticalIcon,
  ArrowLeftIcon, SaveIcon, CheckIcon,
  WrenchIcon, PlugIcon, BookOpenIcon, ServerIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
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
  connectors?: boolean
  mcp?: boolean
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
// 工具定义
// ============================================================

const TOOL_GROUPS = [
  {
    label: "文件",
    tools: [
      { id: "read_file", label: "读取" },
      { id: "write_file", label: "写入" },
      { id: "edit_file", label: "编辑" },
    ],
  },
  {
    label: "搜索",
    tools: [
      { id: "grep", label: "内容搜索" },
      { id: "glob", label: "文件匹配" },
    ],
  },
  {
    label: "系统",
    tools: [
      { id: "bash", label: "终端" },
      { id: "web_fetch", label: "网页" },
    ],
  },
  {
    label: "工作流",
    tools: [
      { id: "cron", label: "定时" },
      { id: "agent", label: "子代理" },
    ],
  },
]

const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools)

// ============================================================
// 工具函数
// ============================================================

function generateId(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "my-agent"
}

function generateDisplayName(instructions: string): string {
  if (!instructions.trim()) return "我的代理"
  // 取第一行非空文本作为名称
  const firstLine = instructions.split("\n").find((l) => l.trim()) ?? instructions
  const cleaned = firstLine.replace(/^#+\s*/, "").trim()
  if (cleaned.length <= 12) return cleaned
  return cleaned.slice(0, 12) + "…"
}

function toggleArrayItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item]
}

// ============================================================
// AgentEditor — 系统提示为核心
// ============================================================

function AgentEditor({
  agent,
  onBack,
  onSaved,
}: {
  agent: Partial<AgentView>
  onBack: () => void
  onSaved: () => void
}) {
  const isEdit = !!agent.agentType

  const [instructions, setInstructions] = useState(agent.instructions ?? "")
  const [displayName, setDisplayName] = useState(agent.displayName ?? "")
  const [agentType, setAgentType] = useState(agent.agentType ?? "")
  const [model, setModel] = useState(agent.model ?? "inherit")
  const [selectedTools, setSelectedTools] = useState<string[]>(agent.tools ?? [])
  const [useConnectors, setUseConnectors] = useState(agent.connectors ?? true)
  const [useSkills, setUseSkills] = useState(agent.skills !== undefined ? agent.skills!.length > 0 : true)
  const [useMcp, setUseMcp] = useState(agent.mcp ?? true)
  const [saving, setSaving] = useState(false)

  const autoId = useMemo(() => isEdit ? agentType : generateId(instructions), [instructions, agentType, isEdit])
  const autoDisplayName = useMemo(
    () => isEdit ? (displayName || agent.displayName) : generateDisplayName(instructions),
    [instructions, displayName, isEdit, agent.displayName],
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      const data = {
        agentType: autoId,
        displayName: autoDisplayName || undefined,
        description: instructions.slice(0, 200),
        instructions,
        model,
        tools: selectedTools,
        connectors: useConnectors,
        skills: useSkills ? [] : [],
        mcp: useMcp,
      }
      const url = isEdit
        ? `/api/agents?agentType=${encodeURIComponent(agent.agentType!)}`
        : "/api/agents"
      const method = isEdit ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        onSaved()
        onBack()
      }
    } finally {
      setSaving(false)
    }
  }

  const hasInstructions = instructions.trim().length > 0

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <BotIcon className="size-5 shrink-0" />
          <h1 className="text-base font-semibold">
            {isEdit ? "编辑代理" : "创建代理"}
          </h1>
          {isEdit && (
            <Badge variant="secondary" className="text-xs font-mono">{agent.agentType}</Badge>
          )}
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving || !hasInstructions}>
          <SaveIcon className="size-3.5 mr-1.5" />
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-2xl mx-auto px-8 py-8 space-y-8">

          {/* ═══ 系统提示 — 核心，最大最突出 ═══ */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">系统提示</p>
              {!isEdit && (
                <p className="text-xs text-muted-foreground/50">
                  告诉它你是谁、要做什么、怎么做
                </p>
              )}
            </div>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={`你是一个智能助手。

你的核心职责是：
- 帮我处理 xxx
- 当出现 yyy 时，执行 zzz

行为规则：
- 保持简洁高效
- 遇到不确定的情况，先确认再执行`}
              rows={14}
              className="text-sm leading-relaxed resize-y min-h-50"
            />
          </section>

          {/* ═══ 基础配置 ═══ */}
          <section className="space-y-5">
            {/* 名称 + 模型 */}
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">名称</p>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={autoDisplayName}
                  className="h-10 text-sm"
                />
                {!isEdit && hasInstructions && (
                  <p className="text-xs text-muted-foreground/50">
                    ID: <span className="font-mono">{autoId}</span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">模型智力</p>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">继承当前设置</SelectItem>
                    <SelectItem value="fast">快速（更快，更便宜）</SelectItem>
                    <SelectItem value="smart">智能（更准，更贵）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 系统工具 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <WrenchIcon className="size-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">系统工具</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {TOOL_GROUPS.map((group) =>
                  group.tools.map((tool) => {
                    const selected = selectedTools.includes(tool.id)
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm border transition-all cursor-pointer ${
                          selected
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                        onClick={() => setSelectedTools((prev) => toggleArrayItem(prev, tool.id))}
                      >
                        {selected && <CheckIcon className="size-3.5" />}
                        {tool.label}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* 能力开关 */}
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">能力</p>
              <div className="space-y-1">
                <div className="flex items-center justify-between py-3 border-b">
                  <div className="flex items-center gap-3">
                    <PlugIcon className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm">连接器</p>
                      <p className="text-xs text-muted-foreground/60">飞书、微信等外部服务</p>
                    </div>
                  </div>
                  <Switch checked={useConnectors} onCheckedChange={setUseConnectors} />
                </div>
                <div className="flex items-center justify-between py-3 border-b">
                  <div className="flex items-center gap-3">
                    <BookOpenIcon className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm">技能</p>
                      <p className="text-xs text-muted-foreground/60">预定义的专业能力包</p>
                    </div>
                  </div>
                  <Switch checked={useSkills} onCheckedChange={setUseSkills} />
                </div>
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <ServerIcon className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm">MCP 服务</p>
                      <p className="text-xs text-muted-foreground/60">外部工具服务器</p>
                    </div>
                  </div>
                  <Switch checked={useMcp} onCheckedChange={setUseMcp} />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// AgentCard — 列表卡片
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
    <div className={`rounded-lg border p-4 transition-colors relative ${
      enabled
        ? "hover:border-accent/50 hover:bg-accent/20"
        : "opacity-60 border-dashed"
    }`}>
      <div className="flex items-start justify-between gap-3">
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
              <Badge variant="secondary" className={`text-xs ${sourceColors[agent.source] ?? ""}`}>
                {sourceLabels[agent.source] ?? agent.source}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {agent.description}
            </p>
            {agent.tools && agent.tools.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap pt-1">
                {agent.tools.slice(0, 6).map((t) => {
                  const tool = ALL_TOOLS.find((at) => at.id === t)
                  return (
                    <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                      {tool?.label ?? t}
                    </Badge>
                  )
                })}
                {agent.tools.length > 6 && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    +{agent.tools.length - 6}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

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
                  : enabled ? "点击禁用" : "点击启用"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

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
  const [editorAgent, setEditorAgent] = useState<Partial<AgentView> | null>(null)

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
      if (!res.ok) throw new Error("Failed to toggle agent")
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

  const filteredAgents = useMemo(() => {
    if (!search) return agents
    const q = search.toLowerCase()
    return agents.filter((a) => {
      const name = (a.displayName ?? a.agentType).toLowerCase()
      const desc = (a.description ?? "").toLowerCase()
      return name.includes(q) || a.agentType.toLowerCase().includes(q) || desc.includes(q)
    })
  }, [agents, search])

  const deleteTarget = confirmDelete ? agents.find((a) => a.agentType === confirmDelete) : null

  if (editorAgent) {
    return (
      <AgentEditor
        agent={editorAgent}
        onBack={() => setEditorAgent(null)}
        onSaved={loadAgents}
      />
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
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
        <Button size="sm" onClick={() => router.push("/workbench/agent")}>
          <SparklesIcon className="mr-1 size-4" />
          AI 生成
        </Button>
        <Button size="sm" onClick={() => setEditorAgent({})}>
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
                  点击「AI 生成」通过对话创建，或「手动创建」填写表单
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredAgents.map((agent) => (
              <AgentCard
                key={agent.agentType}
                agent={agent}
                onEdit={() => setEditorAgent(agent)}
                onDelete={() => setConfirmDelete(agent.agentType)}
                onToggleEnabled={(v) => handleToggleEnabled(agent.agentType, v)}
                onOpenWorkbench={() => router.push(`/workbench/agent/${agent.agentType}`)}
              />
            ))}
          </div>
        )}
      </div>

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
                确定要删除代理 &ldquo;{deleteTarget.displayName ?? deleteTarget.agentType}&rdquo; 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(deleteTarget.agentType)}>
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
