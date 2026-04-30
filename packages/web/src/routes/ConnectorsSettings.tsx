import { useCallback, useEffect, useState } from "react"
import { LinkIcon, RefreshCwIcon, ExternalLinkIcon, WrenchIcon, ShieldCheckIcon, PowerIcon, PowerOffIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

interface ConnectorView {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  base_url?: string
  auth: { type: string }
  toolCount: number
}

const authLabels: Record<string, string> = {
  none: "无需认证",
  api_key: "API Key",
  bearer: "Bearer Token",
  custom: "自定义认证",
}

export default function ConnectorsSettings() {
  const [connectors, setConnectors] = useState<ConnectorView[]>([])
  const [isLoading, setIsLoading] = useState(true)

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

  const activeCount = connectors.filter((c) => c.enabled).length

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <Badge variant="secondary" className="text-xs">
          {activeCount} 启用 / {connectors.length} 总计
        </Badge>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadConnectors} disabled={isLoading}>
            <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/connector-admin">
              <ExternalLinkIcon className="size-4" />
              管理面板
            </Link>
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : connectors.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <LinkIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">暂无连接器</p>
              <p className="text-xs">
                在 .thething/connectors/ 目录下创建 YAML 文件来定义新连接器
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {connectors.map((conn) => (
              <ConnectorCard key={conn.id} connector={conn} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectorCard({ connector }: { connector: ConnectorView }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <LinkIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{connector.name}</span>
              <span className="text-xs text-muted-foreground/60 font-mono">
                v{connector.version}
              </span>
              {connector.enabled ? (
                <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25 text-xs">
                  <PowerIcon className="size-3 mr-0.5" />
                  已启用
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  <PowerOffIcon className="size-3 mr-0.5" />
                  已禁用
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {connector.description}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <WrenchIcon className="size-3" />
          <span>{connector.toolCount} 个工具</span>
        </div>
        <div className="flex items-center gap-1">
          <ShieldCheckIcon className="size-3" />
          <span>{authLabels[connector.auth.type] ?? connector.auth.type}</span>
        </div>
        {connector.base_url && (
          <span className="truncate max-w-64 font-mono" title={connector.base_url}>
            {connector.base_url}
          </span>
        )}
      </div>
    </div>
  )
}
