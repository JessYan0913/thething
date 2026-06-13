import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BotIcon, RefreshCwIcon, SearchIcon, SparklesIcon,
  PlusIcon, PencilIcon, TrashIcon, CheckIcon, XIcon,
  CpuIcon, WrenchIcon, ExternalLinkIcon, MoreVerticalIcon,
  FileTextIcon, CopyIcon, ArrowLeftIcon, SaveIcon,
  ChevronDownIcon, ChevronRightIcon, ZapIcon,
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
// AgentEditor — 创建/编辑页面（乔布斯式三步设计）
// ============================================================

/** 从描述生成 kebab-case ID */
function generateId(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "my-agent"
}

/** 从描述智能提炼显示名称（不是截取，而是提取核心动作 + 后缀） */
function generateDisplayName(desc: string): string {
  if (!desc.trim()) return "我的代理"
  // 尝试提取核心动词短语
  const patterns = [
    /(?:帮我|帮忙|能够|可以)?(.{2,10}?)(?:的|助手|代理|机器人|机器人)/,
    /(?:帮我|帮忙)?(.{2,12})/,
  ]
  for (const p of patterns) {
    const m = desc.match(p)
    if (m?.[1]) {
      const core = m[1].trim()
      // 如果核心内容足够短，直接加"助手"后缀
      if (core.length <= 8) return `${core}助手`
      // 否则截取并加省略号
      return `${core.slice(0, 8)}…`
    }
  }
  return desc.slice(0, 8) + "助手"
}

/** 从描述智能推断可用工具 */
function inferToolsFromDescription(desc: string): string[] {
  const lower = desc.toLowerCase()
  const tools: string[] = []
  if (/文件|读取|写入|代码|file|read|write/.test(lower)) tools.push("read_file", "write_file")
  if (/编辑|修改|替换|search|replace/.test(lower)) tools.push("edit_file")
  if (/搜索|查找|grep|search/.test(lower)) tools.push("grep", "glob")
  if (/终端|命令|shell|执行|脚本/.test(lower)) tools.push("bash")
  if (/网页|网站|url|http|fetch|抓取/.test(lower)) tools.push("web_fetch")
  if (/定时|提醒|cron|调度/.test(lower)) tools.push("cron")
  if (/研究|调研|深入/.test(lower)) tools.push("agent", "parallel_agent")
  return tools
}

/** 可用工具定义（分类 + 中文标签 + 说明） */
const TOOL_CATEGORIES = [
  {
    label: "文件操作",
    tools: [
      { id: "read_file", label: "读取", desc: "读取文件内容" },
      { id: "write_file", label: "写入", desc: "创建或覆盖文件" },
      { id: "edit_file", label: "编辑", desc: "搜索替换编辑" },
    ],
  },
  {
    label: "代码搜索",
    tools: [
      { id: "grep", label: "文本搜索", desc: "正则搜索文件内容" },
      { id: "glob", label: "文件匹配", desc: "按模式查找文件" },
    ],
  },
  {
    label: "系统操作",
    tools: [
      { id: "bash", label: "终端", desc: "执行 Shell 命令" },
      { id: "web_fetch", label: "网页抓取", desc: "获取网页内容" },
    ],
  },
  {
    label: "工作流",
    tools: [
      { id: "cron", label: "定时任务", desc: "创建和管理定时任务" },
      { id: "agent", label: "子代理", desc: "委派任务给子代理" },
      { id: "parallel_agent", label: "并行代理", desc: "同时派出多个子代理" },
    ],
  },
]

const ALL_TOOLS = TOOL_CATEGORIES.flatMap((c) => c.tools)

/** 切换数组中的元素 */
function toggleArrayItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item]
}

/** 根据描述自动生成系统指令模板 */
function generateInstructions(desc: string): string {
  if (!desc.trim()) return ""
  return `# 系统指令

你是一个智能助手，核心任务是：${desc}

## 行为规则
- 专注于完成上述任务，不要偏离主题
- 遇到不确定的情况，先确认再执行
- 保持简洁高效的沟通风格
- 如果任务涉及多个步骤，按逻辑顺序逐步完成

## 约束
- 不要执行与核心任务无关的操作
- 涉及敏感操作（删除、发送等）时需确认`
}

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

  // 核心：只需要一个描述输入
  const [description, setDescription] = useState(agent.description ?? "")
  const [displayName, setDisplayName] = useState(agent.displayName ?? "")
  const [agentType, setAgentType] = useState(agent.agentType ?? "")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [skillsExpanded, setSkillsExpanded] = useState(false)

  // 高级设置（默认值合理，不需要用户操心）
  const [model, setModel] = useState(agent.model ?? "inherit")
  const [effort, setEffort] = useState(agent.effort ?? "medium")
  const [maxTurns, setMaxTurns] = useState(agent.maxTurns ?? 20)
  const [selectedTools, setSelectedTools] = useState<string[]>(agent.tools ?? [])
  const [selectedSkills, setSelectedSkills] = useState<string[]>(agent.skills ?? [])
  const [permissionMode, setPermissionMode] = useState(agent.permissionMode ?? "")
  const [memory, setMemory] = useState(agent.memory ?? "")
  const [background, setBackground] = useState(agent.background ?? false)
  const [instructions, setInstructions] = useState(agent.instructions ?? "")

  const [saving, setSaving] = useState(false)

  // 从 API 加载可用技能
  interface SkillItem { name: string; description: string; source?: string }
  const [availableSkills, setAvailableSkills] = useState<SkillItem[]>([])

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => {
        const list: SkillItem[] = data.skills ?? []
        // 确保内置 research 技能始终存在
        if (!list.find((s) => s.name === "research")) {
          list.unshift({ name: "research", description: "多角度并行研究并汇编报告", source: "builtin" })
        }
        setAvailableSkills(list)
      })
      .catch(() => {
        // 加载失败时至少保留内置技能
        setAvailableSkills([{ name: "research", description: "多角度并行研究并汇编报告", source: "builtin" }])
      })
  }, [])

  // 自动生成 ID、显示名称、系统指令
  const autoId = useMemo(() => isEdit ? agentType : generateId(description), [description, agentType, isEdit])
  const autoDisplayName = useMemo(() => isEdit ? (displayName || agent.displayName) : generateDisplayName(description), [description, displayName, isEdit, agent.displayName])
  const inferredTools = useMemo(() => inferToolsFromDescription(description), [description])

  // 系统指令：用户没手动编辑过时，根据描述自动生成
  const autoInstructions = useMemo(() => generateInstructions(description), [description])
  const [instructionsEdited, setInstructionsEdited] = useState(!!agent.instructions)
  const effectiveInstructions = instructionsEdited ? instructions : autoInstructions

  const handleSave = async () => {
    setSaving(true)
    try {
      const data = {
        agentType: autoId,
        displayName: autoDisplayName || undefined,
        description,
        model,
        effort,
        maxTurns,
        tools: selectedTools,
        skills: selectedSkills,
        permissionMode: permissionMode || undefined,
        memory: memory || undefined,
        background,
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

  const hasDescription = description.trim().length > 0

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <BotIcon className="size-5 shrink-0" />
            <h1 className="text-sm font-semibold truncate">
              {isEdit ? "编辑代理" : "创建代理"}
            </h1>
            {isEdit && (
              <Badge variant="secondary" className="text-xs font-mono shrink-0">
                {agent.agentType}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !hasDescription}>
            <SaveIcon className="size-3.5 mr-1" />
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="flex justify-center p-6">
          <div className="w-full max-w-lg space-y-6">

            {/* ═══ 第一步：一句话描述 ═══ */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center size-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">1</div>
                <p className="text-sm font-medium">你的代理想帮你做什么？</p>
              </div>
              <div className="relative">
                <ZapIcon className="absolute left-3 top-3 size-4 text-muted-foreground/40" />
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="比如：帮我监控 GitHub 上的 PR，有新评论时通知我"
                  rows={2}
                  className="pl-9 text-sm resize-none"
                />
              </div>
              {!isEdit && description.trim() && (
                <p className="text-[10px] text-muted-foreground/50 pl-1">
                  ID 将自动设为 <span className="font-mono text-foreground/60">{autoId}</span>
                </p>
              )}
            </section>

            {/* ═══ 第二步：实时预览 ═══ */}
            {hasDescription && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center size-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">2</div>
                  <p className="text-sm font-medium">预览</p>
                </div>
                <div className="rounded-xl border bg-card p-5 space-y-4">
                  {/* 代理头像 + 名称（可直接编辑） */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center size-10 rounded-full bg-primary/10">
                      <BotIcon className="size-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={autoDisplayName}
                        className="h-7 text-sm font-semibold border-none shadow-none focus-visible:ring-1 px-0"
                      />
                      <p className="text-xs text-muted-foreground font-mono">{autoId}</p>
                    </div>
                  </div>
                  {/* 描述 */}
                  <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
                  {/* 能力标签 */}
                  {(selectedTools.length > 0 || effort) && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedTools.map((t) => {
                        const tool = ALL_TOOLS.find((at) => at.id === t)
                        return (
                          <Badge key={t} variant="secondary" className="text-[10px]">
                            {tool?.label ?? t}
                          </Badge>
                        )
                      })}
                      {effort && (
                        <Badge variant="secondary" className={`text-[10px] ${effortColors[effort] ?? ""}`}>
                          {effortLabels[effort] ?? effort}
                        </Badge>
                      )}
                      {maxTurns !== 20 && (
                        <Badge variant="secondary" className="text-[10px]">{maxTurns} 轮</Badge>
                      )}
                    </div>
                  )}
                  {/* 系统指令预览（自动生成，实时展示） */}
                  <div className="rounded-lg bg-muted/30 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-muted-foreground">系统指令</p>
                      {!instructionsEdited && (
                        <span className="text-[10px] text-primary/60">自动生成</span>
                      )}
                    </div>
                    <p className="text-xs text-foreground/70 leading-relaxed font-mono whitespace-pre-wrap line-clamp-4">
                      {effectiveInstructions}
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* ═══ 第三步：高级设置（折叠） ═══ */}
            {hasDescription && (
              <section className="space-y-3">
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center size-6 rounded-full bg-muted text-muted-foreground text-xs font-bold">3</div>
                    <span>高级设置</span>
                    {!showAdvanced && <span className="text-[10px] text-muted-foreground/50">默认已经很合理，通常不需要改</span>}
                  </div>
                </button>

                {showAdvanced && (
                  <div className="rounded-xl border bg-card p-5 space-y-5">
                    {/* 模型 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">模型</Label>
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">继承当前设置</SelectItem>
                          <SelectItem value="fast">快速（更快，更便宜）</SelectItem>
                          <SelectItem value="smart">智能（更准，更贵）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 精力/难度 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">精力投入</Label>
                      <div className="flex gap-2">
                        {(["low", "medium", "high"] as const).map((e) => (
                          <button
                            key={e}
                            type="button"
                            className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-all cursor-pointer ${
                              effort === e
                                ? "border-primary bg-primary/5 text-foreground font-medium"
                                : "border-border text-muted-foreground hover:border-primary/50"
                            }`}
                            onClick={() => setEffort(e)}
                          >
                            <span className="block text-xs font-medium">{effortLabels[e]}</span>
                            <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                              {e === "low" ? "快速响应" : e === "medium" ? "平衡选择" : "深度思考"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 最大轮次 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">最大轮次</Label>
                      <Input
                        type="number" min={1} max={100}
                        value={maxTurns}
                        onChange={(e) => setMaxTurns(Number(e.target.value) || 20)}
                        className="h-9 text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground/50">单次对话最多执行多少轮工具调用</p>
                    </div>

                    {/* 权限模式 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">权限模式</Label>
                      <Select value={permissionMode} onValueChange={setPermissionMode}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="默认（需要确认）" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="acceptEdits">接受编辑（自动确认文件修改）</SelectItem>
                          <SelectItem value="plan">计划模式（只读，不执行）</SelectItem>
                          <SelectItem value="bypassPermissions">完全信任（跳过所有确认）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 记忆范围 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">记忆范围</Label>
                      <Select value={memory} onValueChange={setMemory}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="默认（仅本次对话）" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">用户级（跨对话记住你）</SelectItem>
                          <SelectItem value="project">项目级（记住项目上下文）</SelectItem>
                          <SelectItem value="local">本地（记住本地环境）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 工具与技能 */}
                    <div className="space-y-4">
                      <p className="text-xs font-medium text-muted-foreground">工具与技能</p>

                      {/* 工具选择器 — 按分类展示 */}
                      <div className="space-y-3">
                        <Label className="text-xs text-muted-foreground">工具</Label>
                        {inferredTools.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-muted-foreground/50">推荐：</span>
                            {inferredTools.filter((t) => !selectedTools.includes(t)).map((t) => {
                              const tool = ALL_TOOLS.find((at) => at.id === t)
                              return (
                                <button
                                  key={t}
                                  type="button"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-dashed border-primary/40 text-primary/70 hover:border-primary hover:text-primary cursor-pointer transition-colors"
                                  onClick={() => setSelectedTools((prev) => toggleArrayItem(prev, t))}
                                >
                                  <span className="size-2.5 rounded-full bg-primary/20" />
                                  {tool?.label ?? t}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {TOOL_CATEGORIES.map((cat) => (
                          <div key={cat.label} className="space-y-1.5">
                            <p className="text-[10px] text-muted-foreground/50">{cat.label}</p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {cat.tools.map((tool) => {
                                const selected = selectedTools.includes(tool.id)
                                return (
                                  <button
                                    key={tool.id}
                                    type="button"
                                    title={tool.desc}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer ${
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

                      {/* 技能选择器 — 从 API 动态加载，支持折叠 */}
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">技能</Label>
                        {(() => {
                          const SKILL_SHOW_MAX = 6
                          // 已选中的排前面，未选中的排后面
                          const sorted = [...availableSkills].sort((a, b) => {
                            const as = selectedSkills.includes(a.name) ? 0 : 1
                            const bs = selectedSkills.includes(b.name) ? 0 : 1
                            return as - bs
                          })
                          const needCollapse = sorted.length > SKILL_SHOW_MAX
                          const visibleSkills = skillsExpanded || !needCollapse ? sorted : sorted.slice(0, SKILL_SHOW_MAX)
                          const hiddenCount = sorted.length - SKILL_SHOW_MAX
                          return (
                            <>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {visibleSkills.map((skill) => {
                                  const selected = selectedSkills.includes(skill.name)
                                  return (
                                    <button
                                      key={skill.name}
                                      type="button"
                                      title={skill.description}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer ${
                                        selected
                                          ? "border-primary bg-primary/10 text-primary font-medium"
                                          : "border-border text-muted-foreground hover:border-primary/50"
                                      }`}
                                      onClick={() => setSelectedSkills((prev) => toggleArrayItem(prev, skill.name))}
                                    >
                                      {selected && <CheckIcon className="size-3" />}
                                      {skill.name}
                                      {skill.source === "builtin" && (
                                        <span className="text-[9px] text-muted-foreground/40 ml-0.5">内置</span>
                                      )}
                                    </button>
                                  )
                                })}
                                {needCollapse && (
                                  <button
                                    type="button"
                                    className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground cursor-pointer transition-colors"
                                    onClick={() => setSkillsExpanded((v) => !v)}
                                  >
                                    {skillsExpanded ? "收起" : `+${hiddenCount} 个`}
                                  </button>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground/50">点击选中/取消，选中的技能会在代理中可用</p>
                            </>
                          )
                        })()}
                      </div>
                    </div>

                    {/* 后台运行 */}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">后台运行</Label>
                        <p className="text-[10px] text-muted-foreground/50">即使关闭页面也持续运行</p>
                      </div>
                      <Switch checked={background} onCheckedChange={setBackground} />
                    </div>

                    {/* 系统指令 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">系统指令</Label>
                      <Textarea
                        value={effectiveInstructions}
                        onChange={(e) => {
                          setInstructions(e.target.value)
                          setInstructionsEdited(true)
                        }}
                        placeholder={"# 系统指令\n\n定义代理的行为规则..."}
                        rows={6}
                        className="text-sm font-mono resize-y"
                      />
                      <p className="text-[10px] text-muted-foreground/50">
                        {instructionsEdited
                          ? "已手动编辑，修改描述不会覆盖此内容"
                          : "根据描述自动生成，可手动编辑覆盖"}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
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

  // 编辑器视图
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
