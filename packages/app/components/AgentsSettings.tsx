import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BotIcon, RefreshCwIcon, SearchIcon, SparklesIcon,
  PlusIcon, PencilIcon, TrashIcon,
  ExternalLinkIcon, MoreVerticalIcon,
  ArrowLeftIcon, SaveIcon, CheckIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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

function generateDisplayName(desc: string): string {
  if (!desc.trim()) return "我的代理"
  const patterns = [
    /(?:帮我|帮忙|能够|可以)?(.{2,10}?)(?:的|助手|代理|机器人)/,
    /(?:帮我|帮忙)?(.{2,12})/,
  ]
  for (const p of patterns) {
    const m = desc.match(p)
    if (m?.[1]) {
      const core = m[1].trim()
      if (core.length <= 8) return `${core}助手`
      return `${core.slice(0, 8)}…`
    }
  }
  return desc.slice(0, 8) + "助手"
}

/** 从描述推断推荐工具 */
function inferToolsFromDescription(desc: string): string[] {
  const lower = desc.toLowerCase()
  const tools: string[] = []
  if (/文件|读取|写入|代码|file|read|write/.test(lower)) tools.push("read_file", "write_file")
  if (/编辑|修改|替换|search|replace/.test(lower)) tools.push("edit_file")
  if (/搜索|查找|grep|search/.test(lower)) tools.push("grep", "glob")
  if (/终端|命令|shell|执行|脚本/.test(lower)) tools.push("bash")
  if (/网页|网站|url|http|fetch|抓取/.test(lower)) tools.push("web_fetch")
  if (/定时|提醒|cron|调度/.test(lower)) tools.push("cron")
  if (/研究|调研|深入/.test(lower)) tools.push("agent")
  return tools
}

function generateInstructions(desc: string): string {
  if (!desc.trim()) return ""
  return `你是一个智能助手，核心任务是：${desc}

行为规则：
- 专注于完成上述任务，不要偏离主题
- 遇到不确定的情况，先确认再执行
- 保持简洁高效的沟通风格
- 涉及敏感操作（删除、发送等）时需确认`
}

function toggleArrayItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item]
}

// ============================================================
// AgentEditor — 核心三件事：描述、工具、系统提示
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

  const [description, setDescription] = useState(agent.description ?? "")
  const [displayName, setDisplayName] = useState(agent.displayName ?? "")
  const [agentType, setAgentType] = useState(agent.agentType ?? "")
  const [selectedTools, setSelectedTools] = useState<string[]>(agent.tools ?? [])
  const [instructions, setInstructions] = useState(agent.instructions ?? "")
  const [instructionsEdited, setInstructionsEdited] = useState(!!agent.instructions)
  const [saving, setSaving] = useState(false)

  const autoId = useMemo(() => isEdit ? agentType : generateId(description), [description, agentType, isEdit])
  const autoDisplayName = useMemo(
    () => isEdit ? (displayName || agent.displayName) : generateDisplayName(description),
    [description, displayName, isEdit, agent.displayName],
  )
  const autoInstructions = useMemo(() => generateInstructions(description), [description])
  const effectiveInstructions = instructionsEdited ? instructions : autoInstructions

  // 根据描述推荐工具（仅首次输入时推荐，用户手动选过之后不再覆盖）
  const inferredTools = useMemo(() => inferToolsFromDescription(description), [description])

  const handleSave = async () => {
    setSaving(true)
    try {
      const data = {
        agentType: autoId,
        displayName: autoDisplayName || undefined,
        description,
        tools: selectedTools,
        instructions: effectiveInstructions,
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <BotIcon className="size-5 shrink-0" />
          <h1 className="text-sm font-semibold">
            {isEdit ? "编辑代理" : "创建代理"}
          </h1>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving || !description.trim()}>
          <SaveIcon className="size-3.5 mr-1" />
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="flex justify-center p-6">
          <div className="w-full max-w-lg space-y-6">

            {/* ═══ 1. 描述 ═══ */}
            <section className="space-y-2">
              <p className="text-sm font-medium">做什么</p>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="比如：帮我监控 GitHub 上的 PR，有新评论时通知我"
                rows={2}
                className="text-sm resize-none"
              />
              {description.trim() && !isEdit && (
                <p className="text-xs text-muted-foreground">
                  ID: <span className="font-mono">{autoId}</span>
                </p>
              )}
            </section>

            {/* 名称（内联） */}
            {description.trim() && (
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground shrink-0">名称</p>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={autoDisplayName}
                  className="h-8 text-sm"
                />
              </div>
            )}

            {/* ═══ 2. 工具 ═══ */}
            {description.trim() && (
              <section className="space-y-3">
                <p className="text-sm font-medium">工具</p>

                {/* 推荐工具 */}
                {inferredTools.length > 0 && selectedTools.length === 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">推荐：</span>
                    {inferredTools.map((t) => {
                      const tool = ALL_TOOLS.find((at) => at.id === t)
                      return (
                        <button
                          key={t}
                          type="button"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-dashed border-primary/40 text-primary/70 hover:border-primary hover:text-primary cursor-pointer transition-colors"
                          onClick={() => setSelectedTools((prev) => toggleArrayItem(prev, t))}
                        >
                          {tool?.label ?? t}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* 工具分类 */}
                <div className="space-y-3">
                  {TOOL_GROUPS.map((group) => (
                    <div key={group.label} className="space-y-1.5">
                      <p className="text-xs text-muted-foreground/60">{group.label}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {group.tools.map((tool) => {
                          const selected = selectedTools.includes(tool.id)
                          return (
                            <button
                              key={tool.id}
                              type="button"
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary font-medium"
                                  : "border-border text-muted-foreground hover:border-primary/50"
                              }`}
                              onClick={() => setSelectedTools((prev) => toggleArrayItem(prev, tool.id))}
                            >
                              {selected && <CheckIcon className="size-3" />}
                              {tool.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ═══ 3. 系统提示 ═══ */}
            {description.trim() && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">系统提示</p>
                  {!instructionsEdited && (
                    <button
                      type="button"
                      className="text-xs text-primary/60 hover:text-primary cursor-pointer transition-colors"
                      onClick={() => setInstructionsEdited(true)}
                    >
                      自定义
                    </button>
                  )}
                </div>
                <Textarea
                  value={effectiveInstructions}
                  onChange={(e) => {
                    setInstructions(e.target.value)
                    setInstructionsEdited(true)
                  }}
                  rows={6}
                  className="text-xs font-mono resize-y"
                />
              </section>
            )}
          </div>
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
            {/* 工具标签 */}
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
