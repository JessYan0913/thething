'use client'

import { useEffect, useState } from "react"
import {
  CableIcon, ArrowLeftIcon, RefreshCwIcon,
  WrenchIcon, GlobeIcon, ShieldIcon, WebhookIcon,
  ChevronDownIcon, FileTextIcon, EyeIcon, EyeOffIcon,
  SaveIcon, XIcon, CheckIcon, TrashIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilePreview } from "@/components/FilePreview"
import { DetailPageHeader, type MenuItem } from "@/components/ui/detail-page-header"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"

interface ToolView {
  name: string
  description: string
  executor: string
  timeout_ms?: number
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

export default function ConnectorsDetail({
  connectorId,
  onBack,
}: {
  connectorId: string
  onBack: () => void
}) {
  const [connector, setConnector] = useState<ConnectorView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 变量编辑状态
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set())
  const [showConfig, setShowConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 工具展开状态
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  // 删除状态
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadConnector = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/connectors?id=${encodeURIComponent(connectorId)}`)
      if (res.ok) {
        const data = await res.json()
        setConnector(data)
        if (data.variables) {
          setVariableValues(data.variables ?? {})
        }
      } else {
        setError("连接器不存在")
      }
    } catch {
      setError("加载失败")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadConnector() }, [connectorId])

  const handleSaveVariables = async () => {
    if (!connector) return
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
        loadConnector()
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

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/connectors?id=${encodeURIComponent(connectorId)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onBack()
      } else {
        const err = await res.json()
        alert(err.error ?? '删除失败')
      }
    } catch {
      alert('网络错误')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        加载中...
      </div>
    )
  }

  if (error || !connector) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <CableIcon className="size-12 opacity-20" />
        <p className="text-sm">{error || "连接器不存在"}</p>
        <Button size="sm" onClick={onBack}>返回</Button>
      </div>
    )
  }

  const menuItems: MenuItem[] = [
    {
      label: "刷新",
      icon: <RefreshCwIcon className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />,
      onClick: loadConnector,
    },
    { divider: true, label: "", icon: null, onClick: () => {} },
    {
      label: "删除",
      icon: <TrashIcon className="size-3.5" />,
      onClick: () => setShowDeleteConfirm(true),
      destructive: true,
    },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      <DetailPageHeader
        onBack={onBack}
        icon={<CableIcon />}
        title={connector.name}
        badges={
          <>
            <Badge variant="secondary" className="text-xs font-mono">{connector.id}</Badge>
            <span className="text-xs text-muted-foreground/60 font-mono">v{connector.version}</span>
            <Badge
              variant={connector.enabled ? "default" : "secondary"}
              className="text-xs"
            >
              {connector.enabled ? "已启用" : "已禁用"}
            </Badge>
          </>
        }
        menuItems={menuItems}
        extraButtons={connector.sourcePath ? (
          <Button
            variant={showConfig ? "default" : "ghost"}
            size="sm"
            onClick={() => setShowConfig((v) => !v)}
          >
            {showConfig ? (
              <XIcon className="size-3.5 mr-1" />
            ) : (
              <FileTextIcon className="size-3.5 mr-1" />
            )}
            {showConfig ? '关闭源码' : '源码'}
          </Button>
        ) : undefined}
      />

      {/* Content */}
      <div className={`flex-1 min-h-0 ${showConfig ? 'flex' : 'overflow-auto'}`}>
        {/* Left: Details */}
        <div className={`${showConfig ? 'w-1/2 min-w-0 overflow-auto p-6 border-r' : 'p-6'} space-y-6`}>
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
              <p className="text-sm">{authTypeLabels[connector.auth?.type] ?? connector.auth?.type ?? "未知"}</p>
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
                  <div key={tool.name} className="rounded-lg border overflow-hidden">
                    <button
                      onClick={() => toggleTool(tool.name)}
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-medium truncate">{tool.name}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {executorLabels[tool.executor] ?? tool.executor}
                        </Badge>
                        {tool.timeout_ms && (
                          <span className="text-xs text-muted-foreground shrink-0">{tool.timeout_ms}ms</span>
                        )}
                      </div>
                      <ChevronDownIcon className={`size-4 text-muted-foreground transition-transform ${expandedTools.has(tool.name) ? "rotate-180" : ""}`} />
                    </button>

                    {expandedTools.has(tool.name) && (
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
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Config file preview */}
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

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDelete}
        itemName={connector.name}
        deleting={deleting}
      />
    </div>
  )
}
