import { useCallback, useEffect, useState } from "react"
import {
  CableIcon, RefreshCwIcon, WrenchIcon,
  FileTextIcon, ArrowLeftIcon, GlobeIcon,
  ShieldIcon, WebhookIcon, ChevronDownIcon,
  TrashIcon, CheckIcon, XIcon,
  SaveIcon, EyeIcon, EyeOffIcon,
} from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilePreview } from "@/components/FilePreview"

interface ToolView {
  name: string
  description: string
  executor: string
  timeout_ms?: number
  retryable?: boolean
  input_schema?: {
    type: string
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

interface ConnectorView {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  variables?: Record<string, string>
  base_url?: string
  auth: { type: string; config?: Record<string, unknown> }
  inbound?: { enabled: boolean; protocol: string; webhookPath?: string }
  tools: ToolView[]
  toolCount: number
  sourcePath?: string
}

const authTypeLabels: Record<string, string> = {
  none: "无认证",
  api_key: "API Key",
  bearer: "Bearer Token",
  custom: "自定义",
}

const executorLabels: Record<string, string> = {
  http: "HTTP",
  sql: "SQL",
  script: "脚本",
  mock: "Mock",
}

export default function ConnectorsSettings() {
  const [connectors, setConnectors] = useState<ConnectorView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedConnector, setSelectedConnector] = useState<ConnectorView | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const loadConnectors = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/connectors")
      if (res.ok) {
        const data = await res.json()
        setConnectors(data.connectors ?? [])
      }
    } catch {
      setConnectors([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadConnectors() }, [loadConnectors])

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/connectors?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    if (res.ok) {
      setConnectors((prev) => prev.filter((c) => c.id !== id))
    }
    setConfirmDelete(null)
  }, [])

  // Detail view
  if (selectedConnector) {
    return (
      <ConnectorDetail
        connector={selectedConnector}
        isLoading={isLoading}
        onBack={() => setSelectedConnector(null)}
        onRefresh={loadConnectors}
      />
    )
  }

  // List view
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <Badge variant="secondary" className="text-xs">
          {connectors.length} 个连接器
        </Badge>
        <Button variant="ghost" size="sm" onClick={loadConnectors} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : connectors.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <CableIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">暂无连接器</p>
              <p className="text-xs">
                在 .thething/connectors/ 目录下创建 YAML 文件来定义新连接器
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {connectors.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                onClick={() => setSelectedConnector(connector)}
                onDelete={() => handleDelete(connector.id)}
                confirmDelete={confirmDelete === connector.id}
                onConfirmDelete={() => setConfirmDelete(connector.id)}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectorCard({ connector, onClick, onDelete, confirmDelete, onConfirmDelete, onCancelDelete }: {
  connector: ConnectorView
  onClick: () => void
  onDelete: () => void
  confirmDelete: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="rounded-lg border p-4 space-y-3 w-full text-left cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <CableIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{connector.name}</span>
              <Badge
                variant={connector.enabled ? "default" : "secondary"}
                className="text-xs"
              >
                {connector.enabled ? "已启用" : "已禁用"}
              </Badge>
              <span className="text-xs text-muted-foreground/60 font-mono">
                v{connector.version}
              </span>
            </div>
            {connector.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {connector.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete() }}>
                <CheckIcon className="size-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onCancelDelete() }}>
                <XIcon className="size-3" />
              </Button>
            </div>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="hover:text-destructive" onClick={(e) => { e.stopPropagation(); onConfirmDelete() }}>
                    <TrashIcon className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>删除后无法恢复</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-xs">
          <ShieldIcon className="size-3 mr-1" />
          {authTypeLabels[connector.auth.type] ?? connector.auth.type}
        </Badge>
        {connector.toolCount > 0 && (
          <div className="flex items-center gap-1">
            <WrenchIcon className="size-3" />
            <span>{connector.toolCount} 个工具</span>
          </div>
        )}
        {connector.base_url && (
          <div className="flex items-center gap-1">
            <GlobeIcon className="size-3" />
            <span className="font-mono truncate max-w-48">{connector.base_url}</span>
          </div>
        )}
        {connector.inbound?.enabled && (
          <Badge variant="outline" className="text-xs">
            <WebhookIcon className="size-3 mr-1" />
            {connector.inbound.protocol}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
        <span className="font-mono">{connector.id}</span>
      </div>
    </div>
  )
}

function ConnectorDetail({
  connector,
  isLoading,
  onBack,
  onRefresh,
}: {
  connector: ConnectorView
  isLoading: boolean
  onBack: () => void
  onRefresh: () => void
}) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [variableValues, setVariableValues] = useState<Record<string, string>>(() => ({ ...(connector.variables ?? {}) }))
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set())
  const [showConfig, setShowConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Sync variable values when connector changes
  useEffect(() => {
    setVariableValues({ ...(connector.variables ?? {}) })
    setSaveMessage(null)
  }, [connector.id])

  const handleSaveVariables = async () => {
    setSaving(true)
    setSaveMessage(null)
    try {
      const res = await fetch('/api/connectors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: connector.id, variables: variableValues }),
      })
      if (res.ok) {
        setSaveMessage({ type: 'success', text: '变量已保存，配置已重新加载' })
        onRefresh()
      } else {
        const err = await res.json()
        setSaveMessage({ type: 'error', text: err.error ?? '保存失败' })
      }
    } catch {
      setSaveMessage({ type: 'error', text: '网络错误' })
    } finally {
      setSaving(false)
    }
  }

  const toggleTool = (name: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
            返回
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <CableIcon className="size-5 shrink-0" />
            <h1 className="text-lg font-semibold truncate">{connector.name}</h1>
            <Badge variant="secondary" className="text-xs shrink-0">连接器详情</Badge>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Info bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b bg-muted/20 text-xs text-muted-foreground">
        <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-muted-foreground/70">{connector.id}</span>
        <span className="font-mono">v{connector.version}</span>
        <Badge
          variant={connector.enabled ? "default" : "secondary"}
          className="text-xs"
        >
          {connector.enabled ? "已启用" : "已禁用"}
        </Badge>
        <Badge variant="outline" className="text-xs">
          <ShieldIcon className="size-3 mr-1" />
          {authTypeLabels[connector.auth.type] ?? connector.auth.type}
        </Badge>
        {connector.toolCount > 0 && (
          <span className="flex items-center gap-1">
            <WrenchIcon className="size-3" />
            {connector.toolCount} 个工具
          </span>
        )}
        {connector.inbound?.enabled && (
          <Badge variant="outline" className="text-xs">
            <WebhookIcon className="size-3 mr-1" />
            入站: {connector.inbound.protocol}
          </Badge>
        )}
        </div>
        {connector.sourcePath && (
          <Button
            variant={showConfig ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowConfig((v) => !v)}
          >
            <FileTextIcon className="size-3.5 mr-1" />
            源码
          </Button>
        )}
      </div>

      {/* Content area — 点击"配置文件"切换分栏 */}
      <div className={`flex-1 min-h-0 ${showConfig ? 'flex' : 'overflow-auto p-6'}`}>
        {/* 左侧：详情信息 */}
        <div className={`${showConfig ? 'w-1/2 min-w-0 overflow-auto p-6 border-r' : ''} space-y-6`}>
          {/* Description */}
          {connector.description && (
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground">描述</h3>
              <p className="text-sm">{connector.description}</p>
            </div>
          )}

          {/* Variables form */}
          {connector.variables && Object.keys(connector.variables).length > 0 && (
            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <CableIcon className="size-4" />
                变量配置
              </h3>
              <div className="space-y-2.5">
                {Object.keys(connector.variables).map((key) => {
                  const isSensitive = key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') || key.toLowerCase().includes('password')
                  const isVisible = visibleFields.has(key)
                  return (
                    <div key={key} className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">{key}</label>
                      <div className="relative">
                        <input
                          type={isSensitive && !isVisible ? 'password' : 'text'}
                          value={variableValues[key] ?? ''}
                          onChange={(e) => setVariableValues((prev) => ({ ...prev, [key]: e.target.value }))}
                          className={`w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${isSensitive ? 'pr-9' : ''}`}
                          placeholder={`输入 ${key}`}
                        />
                        {isSensitive && (
                          <button
                            type="button"
                            onClick={() => setVisibleFields((prev) => {
                              const next = new Set(prev)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {isVisible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSaveVariables}
                  disabled={saving}
                >
                  <SaveIcon className="size-3.5 mr-1" />
                  {saving ? '保存中...' : '保存变量'}
                </Button>
                {saveMessage && (
                  <span className={`text-xs ${saveMessage.type === 'success' ? 'text-emerald-600' : 'text-destructive'}`}>
                    {saveMessage.text}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Config details grid */}
          <div className="grid grid-cols-2 gap-4">
            {connector.base_url && (
              <div className="rounded-lg border p-3 space-y-1">
                <span className="text-xs text-muted-foreground">基础 URL</span>
                <p className="text-sm font-mono break-all">{connector.base_url}</p>
              </div>
            )}
            <div className="rounded-lg border p-3 space-y-1">
              <span className="text-xs text-muted-foreground">认证方式</span>
              <p className="text-sm">{authTypeLabels[connector.auth.type] ?? connector.auth.type}</p>
            </div>
            {connector.inbound?.enabled && (
              <div className="rounded-lg border p-3 space-y-1">
                <span className="text-xs text-muted-foreground">入站协议</span>
                <div className="space-y-1">
                  <p className="text-sm font-mono">{connector.inbound.protocol}</p>
                  {connector.inbound.webhookPath && (
                    <p className="text-xs text-muted-foreground font-mono">{connector.inbound.webhookPath}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Tools list */}
          {connector.tools.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <WrenchIcon className="size-4" />
                工具 ({connector.tools.length})
              </h3>
              <div className="space-y-2">
                {connector.tools.map((tool) => (
                  <ToolCard
                    key={tool.name}
                    tool={tool}
                    expanded={expandedTools.has(tool.name)}
                    onToggle={() => toggleTool(tool.name)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右侧：配置文件预览 */}
        {connector.sourcePath && showConfig && (
          <div className="w-1/2 min-w-0 overflow-auto p-6 space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <FileTextIcon className="size-4" />
              配置文件
            </h3>
            <FilePreview
              filePath={connector.sourcePath}
              showHeader={true}
              minHeight={300}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ToolCard({
  tool,
  expanded,
  onToggle,
}: {
  tool: ToolView
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{tool.name}</span>
          <Badge variant="outline" className="text-xs shrink-0">
            {executorLabels[tool.executor] ?? tool.executor}
          </Badge>
          {tool.retryable && (
            <Badge variant="secondary" className="text-xs shrink-0">可重试</Badge>
          )}
          {tool.timeout_ms && (
            <span className="text-xs text-muted-foreground shrink-0">{tool.timeout_ms}ms</span>
          )}
        </div>
        <ChevronDownIcon className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t bg-muted/10">
          {tool.description && (
            <div className="pt-3">
              <p className="text-xs text-muted-foreground">{tool.description}</p>
            </div>
          )}

          {tool.input_schema?.properties && Object.keys(tool.input_schema.properties).length > 0 && (
            <div className="pt-2 space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">输入参数</span>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">参数名</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">类型</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">必填</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(tool.input_schema.properties).map(([name, prop]) => (
                      <tr key={name} className="border-t">
                        <td className="px-3 py-1.5 font-mono">{name}</td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{prop.type}</td>
                        <td className="px-3 py-1.5">
                          {tool.input_schema?.required?.includes(name) ? (
                            <Badge variant="destructive" className="text-xs px-1 py-0">必填</Badge>
                          ) : (
                            <span className="text-muted-foreground">可选</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{prop.description ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
