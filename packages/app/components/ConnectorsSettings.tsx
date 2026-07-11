import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CableIcon, RefreshCwIcon, WrenchIcon,
  GlobeIcon, ShieldIcon, WebhookIcon,
  TrashIcon, SearchIcon,
  SparklesIcon, PlusIcon, MoreVerticalIcon,
} from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConnectorUploadDialog } from "@/components/ConnectorUploadDialog"
import { ConnectorGeneratorDialog } from "@/components/ConnectorGeneratorDialog"

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
  tools: Array<{ name: string; description: string; executor: string }>
  toolCount: number
  sourcePath?: string
}

const authTypeLabels: Record<string, string> = {
  none: "无认证",
  api_key: "API Key",
  bearer: "Bearer Token",
  custom: "自定义",
}

// ============================================================
// ConnectorCard — 列表卡片
// ============================================================

function ConnectorCard({
  connector,
  onClick,
  onDelete,
}: {
  connector: ConnectorView
  onClick: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={`rounded-lg border p-4 transition-colors relative ${
      connector.enabled
        ? "hover:border-accent/50 hover:bg-accent/20"
        : "opacity-60 border-dashed"
    }`}>
      <div className="flex items-start justify-between gap-4 min-w-0">
        <button
          onClick={onClick}
          className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer"
        >
          <CableIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-medium text-sm truncate">{connector.name}</span>
              <Badge
                className={`text-xs border-0 ${
                  connector.enabled
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
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
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-1">
              <Badge variant="secondary" className="text-[10px] font-normal">
                <ShieldIcon className="size-3 mr-1" />
                {authTypeLabels[connector.auth.type] ?? connector.auth.type}
              </Badge>
              {connector.toolCount > 0 && (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  <WrenchIcon className="size-3 mr-1" />
                  {connector.toolCount} 个工具
                </Badge>
              )}
              {connector.inbound?.enabled && (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  <WebhookIcon className="size-3 mr-1" />
                  {connector.inbound.protocol}
                </Badge>
              )}
            </div>
          </div>
        </button>

        {/* Actions menu */}
        <div className="relative shrink-0">
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
              <div className="absolute right-0 top-8 z-50 w-36 rounded-md border bg-popover shadow-md">
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
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// ConnectorsSettings — 主组件
// ============================================================

export default function ConnectorsSettings() {
  const router = useRouter()
  const [connectors, setConnectors] = useState<ConnectorView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<ConnectorView | null>(null)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false)

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

  const filteredConnectors = useMemo(() => {
    if (!search) return connectors
    const q = search.toLowerCase()
    return connectors.filter((c) => {
      const name = c.name.toLowerCase()
      const id = c.id.toLowerCase()
      const desc = (c.description ?? "").toLowerCase()
      return name.includes(q) || id.includes(q) || desc.includes(q)
    })
  }, [connectors, search])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索连接器..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={loadConnectors} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="sm" onClick={() => setIsGeneratorOpen(true)}>
          <SparklesIcon className="mr-1 size-4" />
          AI 生成
        </Button>
        <Button size="sm" onClick={() => setIsUploadOpen(true)}>
          <PlusIcon className="mr-1 size-4" />
          上传连接器
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : filteredConnectors.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <CableIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">
                {connectors.length === 0 ? "暂无连接器" : "没有匹配的连接器"}
              </p>
              {connectors.length === 0 && (
                <p className="text-xs">
                  点击「AI 生成」通过对话创建连接器，或「上传连接器」上传 YAML 文件
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
            {filteredConnectors.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                onClick={() => router.push(`/settings/connectors/${connector.id}`)}
                onDelete={() => setConfirmDelete(connector)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(null)}>
          <div
            className="bg-background rounded-lg border shadow-lg max-w-sm w-full mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">确认删除</h3>
              <p className="text-sm text-muted-foreground">
                确定要删除连接器 &ldquo;{confirmDelete.name}&rdquo; 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(confirmDelete.id)}>
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upload dialog */}
      <ConnectorUploadDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onSuccess={loadConnectors}
      />

      {/* Generator dialog */}
      <ConnectorGeneratorDialog
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        onSuccess={loadConnectors}
      />
    </div>
  )
}
