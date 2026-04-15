'use client'

import { useCallback, useEffect, useState } from 'react'
import { PlusIcon, RefreshCwIcon, ServerIcon, TrashIcon, PlugIcon, CheckIcon, XIcon, AlertCircleIcon, CopyIcon, CodeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog'

interface McpServerView {
  name: string
  transportType: 'stdio' | 'sse' | 'http'
  command: string
  args: string
  env: string
  url: string
  enabled: boolean
  status: 'connected' | 'disconnected' | 'error'
  toolCount: number
  error: string | null
}

function configToView(config: Record<string, unknown>): McpServerView {
  const transport = config.transport as Record<string, unknown>
  const type = (transport?.type ?? 'stdio') as McpServerView['transportType']
  return {
    name: (config.name ?? '') as string,
    transportType: type,
    command: (type === 'stdio' ? ((transport?.command ?? '') as string) : '') as string,
    args: (type === 'stdio' && transport?.args ? (transport.args as string[]).join(' ') : '') as string,
    env: (type === 'stdio' && transport?.env ? JSON.stringify(transport.env, null, 2) : '') as string,
    url: (type === 'sse' || type === 'http' ? ((transport?.url ?? '') as string) : '') as string,
    enabled: (config.enabled ?? true) as boolean,
    status: 'disconnected',
    toolCount: 0,
    error: null,
  }
}

export default function McpSettingsPage() {
  const [servers, setServers] = useState<McpServerView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTesting, setIsTesting] = useState<string | null>(null)
  const [jsonInput, setJsonInput] = useState('')
  const [jsonError, setJsonError] = useState('')

  const loadServers = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/mcp')
      if (res.ok) {
        const data = await res.json()
        const configs = (data.servers ?? []) as Record<string, unknown>[]
        setServers(configs.map(configToView))
      }
    } catch {
      setServers([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadServers() }, [loadServers])

  const handleJsonImport = useCallback(async () => {
    setJsonError('')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonInput)
    } catch {
      setJsonError('JSON 格式错误，请检查')
      return
    }

    // 支持两种格式: { mcpServers: {...} } 或直接 { name: {...} }
    const serverBlocks: Record<string, Record<string, unknown>> =
      parsed.mcpServers && typeof parsed.mcpServers === 'object'
        ? parsed.mcpServers as Record<string, Record<string, unknown>>
        : parsed as Record<string, Record<string, unknown>>

    const entries = Object.entries(serverBlocks)
    if (entries.length === 0) {
      setJsonError('未找到任何服务器配置')
      return
    }

    let added = 0
    let failed = 0
    for (const [name, block] of entries) {
      const transport = block.command
        ? { type: 'stdio' as const, command: String(block.command), args: Array.isArray(block.args) ? block.args : [], env: block.env ?? {} }
        : { type: 'sse' as const, url: String(block.url ?? '') }

      try {
        const res = await fetch('/api/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, transport, enabled: true }),
        })
        if (res.ok) added++
        else failed++
      } catch {
        failed++
      }
    }

    if (added > 0) {
      setJsonInput('')
      await loadServers()
    }
    if (failed > 0) {
      setJsonError(`${failed} 个服务器添加失败（可能已存在）`)
    }
  }, [jsonInput, loadServers])

  const handleDelete = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/mcp?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (res.ok) setServers((prev) => prev.filter((s) => s.name !== name))
    } catch { /* ignore */ }
  }, [])

  const handleTest = useCallback(async (name: string) => {
    setIsTesting(name)
    try {
      const res = await fetch(`/api/mcp?name=${encodeURIComponent(name)}&connect=true`)
      if (res.ok) {
        const data = await res.json()
        const snapshot = data.snapshot as { servers: Array<{ name: string; connected: boolean; toolCount: number; error?: string }> }
        setServers((prev) =>
          prev.map((s) =>
            s.name === name
              ? { ...s, status: snapshot.servers[0]?.connected ? 'connected' : 'error', toolCount: snapshot.servers[0]?.toolCount ?? 0, error: snapshot.servers[0]?.error ?? null }
              : s,
          ),
        )
      }
    } catch {
      setServers((prev) => prev.map((s) => s.name === name ? { ...s, status: 'error', error: '连接失败' } : s))
    } finally {
      setIsTesting(null)
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <PlugIcon className="size-5" />
          <h1 className="text-lg font-semibold">MCP 服务器管理</h1>
          <Badge variant="secondary" className="text-xs">
            {servers.filter((s) => s.status === 'connected').length} 已连接 / {servers.length} 总计
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadServers} disabled={isLoading}>
            <RefreshCwIcon className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          {/* JSON Import Dialog */}
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm">
                <CodeIcon className="size-4" />
                粘贴配置
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>粘贴 MCP 配置</DialogTitle>
                <DialogDescription>
                  从 mcp.so 或 Claude Desktop 配置中复制 JSON，粘贴到下方即可自动添加所有服务器。
                </DialogDescription>
              </DialogHeader>

              <Textarea
                className="font-mono text-xs min-h-[240px]"
                placeholder={`{\n  "mcpServers": {\n    "amap-maps": {\n      "command": "npx",\n      "args": ["-y", "@amap/amap-maps-mcp-server"],\n      "env": {\n        "AMAP_MAPS_API_KEY": "your-key"\n      }\n    }\n  }\n}`}
                value={jsonInput}
                onChange={(e) => { setJsonInput(e.target.value); setJsonError('') }}
              />

              {jsonError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircleIcon className="size-4" />
                  {jsonError}
                </div>
              )}

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">取消</Button>
                </DialogClose>
                <Button onClick={handleJsonImport} disabled={!jsonInput.trim()}>
                  <PlusIcon className="size-4" />
                  添加所有服务器
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">加载中...</div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <ServerIcon className="size-8 opacity-40" />
            <p className="text-sm">尚未配置任何 MCP 服务器</p>
            <div className="flex flex-col items-center gap-1 text-xs">
              <p>1. 前往 <a className="text-primary underline" href="https://mcp.so" target="_blank" rel="noreferrer">mcp.so</a> 浏览可用服务器</p>
              <p>2. 复制 Server Config 中的 JSON 配置</p>
              <p>3. 点击"粘贴配置"按钮添加</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {servers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                onDelete={() => handleDelete(server.name)}
                onTest={() => handleTest(server.name)}
                isTesting={isTesting === server.name}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ServerCard({
  server,
  onDelete,
  onTest,
  isTesting,
}: {
  server: McpServerView
  onDelete: () => void
  onTest: () => void
  isTesting: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const configJson = JSON.stringify(
    {
      mcpServers: {
        [server.name]: server.transportType === 'stdio'
          ? { command: server.command, args: server.args ? server.args.split(/\s+/).filter(Boolean) : [], ...(server.env ? JSON.parse(server.env) : {}) }
          : { url: server.url },
      },
    },
    null,
    2,
  )

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ServerIcon className="size-4" />
          <span className="font-medium text-sm">{server.name}</span>
          <StatusBadge status={server.status} />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setShowConfig(!showConfig)} title="查看配置">
            <CopyIcon className="size-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onTest} disabled={isTesting}>
            {isTesting ? <RefreshCwIcon className="size-3 animate-spin" /> : <RefreshCwIcon className="size-3" />}
          </Button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
                <CheckIcon className="size-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                <XIcon className="size-3" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <TrashIcon className="size-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-xs">
          {server.transportType === 'stdio' ? 'Stdio' : server.transportType.toUpperCase()}
        </Badge>
        {server.toolCount > 0 && <span>{server.toolCount} 个工具</span>}
        {server.transportType === 'stdio' && server.command && (
          <span className="truncate max-w-[300px]">{server.command} {server.args}</span>
        )}
        {(server.transportType === 'sse' || server.transportType === 'http') && server.url && (
          <span className="truncate max-w-[300px]">{server.url}</span>
        )}
      </div>

      {showConfig && (
        <div className="relative">
          <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto">{configJson}</pre>
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => navigator.clipboard.writeText(configJson)}
          >
            <CopyIcon className="size-3" />
          </Button>
        </div>
      )}

      {server.error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircleIcon className="size-3" />
          <span className="truncate">{server.error}</span>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: McpServerView['status'] }) {
  switch (status) {
    case 'connected':
      return <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25 text-xs">已连接</Badge>
    case 'error':
      return <Badge variant="destructive" className="text-xs">错误</Badge>
    case 'disconnected':
      return <Badge variant="secondary" className="text-xs">未连接</Badge>
  }
}