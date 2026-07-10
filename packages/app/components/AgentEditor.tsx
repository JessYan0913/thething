'use client'

import { useEffect, useMemo, useState } from "react"
import {
  BotIcon, SaveIcon, ArrowLeftIcon, CheckIcon,
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

interface AgentData {
  agentType?: string
  displayName?: string
  instructions?: string
  model?: string
  tools?: string[]
  connectors?: boolean
  skills?: boolean
  mcp?: boolean
  permission?: string
  source?: string
  metadata?: Record<string, unknown>
}

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

function generateId(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "my-agent"
}

function generateDisplayName(instructions: string): string {
  if (!instructions.trim()) return "我的代理"
  const firstLine = instructions.split("\n").find((l) => l.trim()) ?? instructions
  const cleaned = firstLine.replace(/^#+\s*/, "").trim()
  if (cleaned.length <= 12) return cleaned
  return cleaned.slice(0, 12) + "…"
}

function toggleArrayItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item]
}

// ============================================================
// AgentEditor — 独立页面组件
// ============================================================

export default function AgentEditor({
  agentType,
  onBack,
  onSaved,
}: {
  agentType?: string  // undefined = 创建，有值 = 编辑
  onBack: () => void
  onSaved: () => void
}) {
  const isEdit = !!agentType

  // 从 API 加载 agent 数据
  const [loading, setLoading] = useState(isEdit)
  const [agent, setAgent] = useState<AgentData>({})

  useEffect(() => {
    if (!agentType) return
    fetch(`/api/agents?agentType=${encodeURIComponent(agentType)}`)
      .then((r) => r.json())
      .then((data) => {
        setAgent(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [agentType])

  const [instructions, setInstructions] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [savedAgentType, setSavedAgentType] = useState("")
  const [model, setModel] = useState("inherit")
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [useConnectors, setUseConnectors] = useState(true)
  const [useSkills, setUseSkills] = useState(true)
  const [useMcp, setUseMcp] = useState(true)
  const [permission, setPermission] = useState("smart")
  const [saving, setSaving] = useState(false)

  // agent 数据加载后初始化表单
  useEffect(() => {
    if (!loading && agent.agentType) {
      setInstructions(agent.instructions ?? "")
      setDisplayName(agent.displayName ?? "")
      setSavedAgentType(agent.agentType ?? "")
      setModel(agent.model ?? "inherit")
      setSelectedTools(agent.tools ?? [])
      setUseConnectors(agent.connectors ?? true)
      setUseSkills(agent.skills ?? true)
      setUseMcp(agent.mcp ?? true)
      setPermission(agent.permission ?? "smart")
    }
  }, [loading, agent])

  const autoId = useMemo(
    () => isEdit ? savedAgentType : generateId(instructions),
    [instructions, savedAgentType, isEdit],
  )
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
        instructions,
        model,
        tools: selectedTools,
        connectors: useConnectors,
        skills: useSkills,
        mcp: useMcp,
        permission,
      }
      const url = isEdit
        ? `/api/agents?agentType=${encodeURIComponent(agentType!)}`
        : "/api/agents"
      const method = isEdit ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  const hasInstructions = instructions.trim().length > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        加载中...
      </div>
    )
  }

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
            <Badge variant="secondary" className="text-xs font-mono">{agentType}</Badge>
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

          {/* ═══ 系统提示 ═══ */}
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
            <div className="grid grid-cols-3 gap-4">
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
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">权限</p>
                <Select value={permission} onValueChange={setPermission}>
                  <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smart">智能（需确认）</SelectItem>
                    <SelectItem value="auto-review">自动审核</SelectItem>
                    <SelectItem value="full-trust">完全信任</SelectItem>
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
