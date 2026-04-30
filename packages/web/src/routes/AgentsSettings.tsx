import { useCallback, useEffect, useState } from "react"
import {
  BotIcon, RefreshCwIcon, WrenchIcon,
  FileTextIcon, ArrowLeftIcon,
  CpuIcon, MessageSquareIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilePreview } from "@/components/FilePreview"

interface AgentView {
  agentType: string
  description: string
  displayName?: string
  tools?: string[]
  model?: string | "inherit" | "fast" | "smart"
  effort?: "low" | "medium" | "high" | number
  maxTurns?: number
  permissionMode?: string
  background?: boolean
  memory?: string
  skills?: string[]
  source: string
  filePath?: string
}

const effortLabels: Record<string, string> = {
  low: "轻量",
  medium: "中等",
  high: "高开销",
}

export default function AgentsSettings() {
  const [agents, setAgents] = useState<AgentView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Detail view state
  const [selectedAgent, setSelectedAgent] = useState<AgentView | null>(null)

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

  // Detail view
  if (selectedAgent) {
    const agent = selectedAgent
    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => setSelectedAgent(null)}>
              <ArrowLeftIcon className="size-4" />
              返回
            </Button>
            <div className="flex items-center gap-2 min-w-0">
              <BotIcon className="size-5 shrink-0" />
              <h1 className="text-lg font-semibold truncate">
                {agent.displayName ?? agent.agentType}
              </h1>
              <Badge variant="secondary" className="text-xs shrink-0">
                代理详情
              </Badge>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={loadAgents} disabled={isLoading}>
            <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Agent info bar */}
        <div className="flex items-center gap-3 px-6 py-2 border-b bg-muted/20 text-xs text-muted-foreground flex-wrap">
          {agent.agentType !== agent.displayName && (
            <span className="font-mono text-muted-foreground/70">{agent.agentType}</span>
          )}
          {agent.effort && typeof agent.effort === "string" && (
            <Badge variant="outline" className="text-xs">
              {effortLabels[agent.effort] ?? agent.effort}
            </Badge>
          )}
          {agent.model && (
            <span className="flex items-center gap-1">
              <CpuIcon className="size-3" />
              <span className="font-mono">{typeof agent.model === "string" ? agent.model : "inherit"}</span>
            </span>
          )}
          {agent.tools && agent.tools.length > 0 && (
            <span className="flex items-center gap-1">
              <WrenchIcon className="size-3" />
              {agent.tools.length} 个工具
            </span>
          )}
          {agent.maxTurns && (
            <span className="flex items-center gap-1">
              <MessageSquareIcon className="size-3" />
              最多 {agent.maxTurns} 轮
            </span>
          )}
          {agent.background && (
            <Badge variant="secondary" className="text-xs">后台运行</Badge>
          )}
          {agent.source && (
            <Badge variant="outline" className="text-xs">{agent.source}</Badge>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-6">
          {/* Description */}
          <div className="mb-6 space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">描述</h3>
            <p className="text-sm">{agent.description}</p>
          </div>

          {/* Config details grid */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {agent.memory && (
              <div className="rounded-lg border p-3 space-y-1">
                <span className="text-xs text-muted-foreground">记忆配置</span>
                <p className="text-sm font-mono">{agent.memory}</p>
              </div>
            )}
            {agent.skills && agent.skills.length > 0 && (
              <div className="rounded-lg border p-3 space-y-1">
                <span className="text-xs text-muted-foreground">关联技能</span>
                <div className="flex flex-wrap gap-1">
                  {agent.skills.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
            {agent.permissionMode && (
              <div className="rounded-lg border p-3 space-y-1">
                <span className="text-xs text-muted-foreground">权限模式</span>
                <p className="text-sm font-mono">{agent.permissionMode}</p>
              </div>
            )}
            {agent.tools && agent.tools.length > 0 && (
              <div className="rounded-lg border p-3 space-y-1">
                <span className="text-xs text-muted-foreground">可用工具</span>
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((t) => (
                    <Badge key={t} variant="outline" className="text-xs font-mono">{t}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Config file preview */}
          {agent.filePath && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <FileTextIcon className="size-4" />
                配置文件
              </h3>
              <FilePreview
                filePath={agent.filePath}
                showHeader={true}
                minHeight={300}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <Badge variant="secondary" className="text-xs">
          {agents.length} 个代理
        </Badge>
        <Button variant="ghost" size="sm" onClick={loadAgents} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <BotIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">暂无代理</p>
              <p className="text-xs">
                在 .thething/agents/ 目录下创建 Markdown 文件来定义新代理
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.agentType}
                agent={agent}
                onClick={() => setSelectedAgent(agent)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AgentCard({ agent, onClick }: { agent: AgentView; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border p-4 space-y-3 w-full text-left hover:border-accent/50 hover:bg-accent/20 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <BotIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">
                {agent.displayName ?? agent.agentType}
              </span>
              {agent.agentType !== agent.displayName && (
                <span className="text-xs text-muted-foreground/60 font-mono">
                  {agent.agentType}
                </span>
              )}
              {agent.effort && typeof agent.effort === "string" && (
                <Badge variant="outline" className="text-xs">
                  {effortLabels[agent.effort] ?? agent.effort}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {agent.description}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {agent.model && (
          <div className="flex items-center gap-1">
            <CpuIcon className="size-3" />
            <span className="font-mono">{typeof agent.model === "string" ? agent.model : "inherit"}</span>
          </div>
        )}
        {agent.tools && agent.tools.length > 0 && (
          <div className="flex items-center gap-1">
            <WrenchIcon className="size-3" />
            <span>{agent.tools.length} 个工具</span>
          </div>
        )}
        {agent.maxTurns && (
          <span>最多 {agent.maxTurns} 轮</span>
        )}
        {agent.background && (
          <Badge variant="secondary" className="text-xs">后台运行</Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {agent.source}
        </Badge>
      </div>

      {agent.filePath && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          <FileTextIcon className="size-3" />
          <span className="truncate">{agent.filePath}</span>
        </div>
      )}
    </button>
  )
}
