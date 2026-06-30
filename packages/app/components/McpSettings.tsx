import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from "next-themes"
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view"
import { EditorState, Compartment } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { lintKeymap } from "@codemirror/lint"
import { json } from "@codemirror/lang-json"
import { oneDark } from "@codemirror/theme-one-dark"
import { PlusIcon, RefreshCwIcon, ServerIcon, TrashIcon, CheckIcon, XIcon, AlertCircleIcon, CopyIcon, CodeIcon, PencilIcon, ChevronDownIcon, ChevronRightIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
  headers: string
  enabled: boolean
  autoConnect?: boolean
  alwaysLoad?: boolean
  connectionTimeout?: number
  status: 'connected' | 'disconnected' | 'error'
  toolCount: number
  tools: Array<{ name: string; description?: string }>
  error: string | null
}

function configToView(config: Record<string, unknown>, snapshotEntry?: { connected: boolean; toolCount: number; tools?: Array<{ name: string; description?: string }>; error?: string }): McpServerView {
  const transport = config.transport as Record<string, unknown>
  const type = (transport?.type ?? 'stdio') as McpServerView['transportType']
  return {
    name: (config.name ?? '') as string,
    transportType: type,
    command: (type === 'stdio' ? ((transport?.command ?? '') as string) : '') as string,
    args: (type === 'stdio' && transport?.args ? (transport.args as string[]).join(' ') : '') as string,
    env: (type === 'stdio' && transport?.env ? JSON.stringify(transport.env, null, 2) : '') as string,
    url: (type === 'sse' || type === 'http' ? ((transport?.url ?? '') as string) : '') as string,
    headers: ((type === 'sse' || type === 'http') && transport?.headers ? JSON.stringify(transport.headers, null, 2) : '') as string,
    enabled: (config.enabled ?? true) as boolean,
    autoConnect: config.autoConnect as boolean | undefined,
    alwaysLoad: config.alwaysLoad as boolean | undefined,
    connectionTimeout: config.connectionTimeout as number | undefined,
    status: snapshotEntry ? (snapshotEntry.connected ? 'connected' : 'error') : 'disconnected',
    toolCount: snapshotEntry?.toolCount ?? 0,
    tools: snapshotEntry?.tools ?? [],
    error: snapshotEntry?.error ?? null,
  }
}

export default function McpSettingsPage() {
  const [servers, setServers] = useState<McpServerView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [isTesting, setIsTesting] = useState<string | null>(null)
  const [jsonInput, setJsonInput] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [editServer, setEditServer] = useState<McpServerView | null>(null)
  const [editForm, setEditForm] = useState<McpServerView | null>(null)
  const [editError, setEditError] = useState('')

  const loadServers = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/mcp')
      if (res.ok) {
        const data = await res.json()
        const configs = (data.servers ?? []) as Record<string, unknown>[]
        const snapshotServers = (data.snapshot?.servers ?? []) as Array<{ name: string; connected: boolean; toolCount: number; tools?: Array<{ name: string; description?: string }>; error?: string }>
        setServers(configs.map((c: Record<string, unknown>) =>
          configToView(c, snapshotServers.find((s: { name: string }) => s.name === c.name)),
        ))
      }
    } catch {
      setServers([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadServers() }, [loadServers])

  // 自动轮询：有服务器未连接时每 5s 拉一次 snapshot
  useEffect(() => {
    const hasDisconnected = servers.some(s => s.status === 'disconnected' || s.status === 'error')
    if (!hasDisconnected) return
    const interval = setInterval(loadServers, 5000)
    return () => clearInterval(interval)
  }, [servers, loadServers])

  const handleJsonImport = useCallback(async () => {
    setJsonError('')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonInput)
    } catch {
      setJsonError('JSON 格式错误，请检查')
      return
    }

    // 支持三种格式:
    //   1. { mcpServers: { name: { command, ... } } } (Dot Agents)
    //   2. { name: { command, url, transport, ... } }   (单服务器 Dot Agents)
    //   3. { name, transport: { type, url, ... } }       (TheThing API 格式)

    // 情况 3: 单个 TheThing 格式服务器
    if (typeof parsed.name === 'string' && parsed.transport && typeof parsed.transport === 'object' && 'type' in (parsed.transport as object)) {
      try {
        const res = await fetch('/api/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        })
        if (res.ok) {
          setJsonInput('')
          await loadServers()
        } else {
          const err = await res.json()
          setJsonError(err.error ?? '添加失败')
        }
      } catch {
        setJsonError('网络错误，请重试')
      }
      return
    }

    // 情况 1 & 2: Dot Agents 扁平格式
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
    const results = await Promise.all(
      entries.map(async ([name, block]) => {
        // 读取传输类型（Dot Agents 扁平格式：transport 为字符串）
        const dotTransport = typeof block.transport === 'string' ? (block.transport as string) : null

        const isStdio = !!(block.command) || dotTransport === 'stdio'

        let transport: Record<string, unknown>
        if (isStdio) {
          transport = {
            type: 'stdio',
            command: String(block.command ?? ''),
            args: Array.isArray(block.args) ? block.args : [],
            ...(block.env ? { env: block.env } : {}),
          }
        } else {
          const tType = (dotTransport === 'http' || dotTransport === 'streamable-http') ? dotTransport : 'sse'
          transport = {
            type: tType,
            url: String(block.url ?? ''),
            ...(block.headers ? { headers: block.headers } : {}),
          }
        }

        try {
          const res = await fetch('/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, transport, enabled: block.enabled !== false }),
          })
          return res.ok
        } catch {
          return false
        }
      })
    )
    for (const ok of results) {
      if (ok) added++
      else failed++
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
        const snapshot = data.snapshot as { servers: Array<{ name: string; connected: boolean; toolCount: number; tools?: Array<{ name: string; description?: string }>; error?: string }> }
        setServers((prev) =>
          prev.map((s) =>
            s.name === name
              ? { ...s, status: snapshot.servers[0]?.connected ? 'connected' : 'error', toolCount: snapshot.servers[0]?.toolCount ?? 0, tools: snapshot.servers[0]?.tools ?? [], error: snapshot.servers[0]?.error ?? null }
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

  const handleEdit = useCallback((server: McpServerView) => {
    setEditServer(server)
    setEditForm({ ...server })
    setEditError('')
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editForm || !editServer) return
    setEditError('')

    const nameChanged = editForm.name !== editServer.name

    try {
      // Build transport
      let transport: Record<string, unknown>
      if (editForm.transportType === 'stdio') {
        const env = editForm.env ? JSON.parse(editForm.env) : undefined
        transport = {
          type: 'stdio',
          command: editForm.command,
          args: editForm.args ? editForm.args.split(/\s+/).filter(Boolean) : [],
          ...(env ? { env } : {}),
        }
      } else {
        const headers = editForm.headers ? JSON.parse(editForm.headers) : undefined
        transport = {
          type: editForm.transportType,
          url: editForm.url,
          ...(headers ? { headers } : {}),
        }
      }

      if (nameChanged) {
        // Delete old, create new
        await fetch(`/api/mcp?name=${encodeURIComponent(editServer.name)}`, { method: 'DELETE' })
        const res = await fetch('/api/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editForm.name, transport, enabled: editForm.enabled }),
        })
        if (!res.ok) {
          const err = await res.json()
          setEditError(err.error ?? '保存失败')
          return
        }
      } else {
        const res = await fetch(`/api/mcp?name=${encodeURIComponent(editForm.name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transport, enabled: editForm.enabled }),
        })
        if (!res.ok) {
          const err = await res.json()
          setEditError(err.error ?? '保存失败')
          return
        }
      }

      setEditServer(null)
      setEditForm(null)
      await loadServers()
    } catch {
      setEditError('网络错误，请重试')
    }
  }, [editForm, editServer, loadServers])

  const filteredServers = useMemo(() => {
    if (!search) return servers
    const q = search.toLowerCase()
    return servers.filter((s) => {
      const name = s.name.toLowerCase()
      const cmd = s.command.toLowerCase()
      const url = s.url.toLowerCase()
      return name.includes(q) || cmd.includes(q) || url.includes(q)
    })
  }, [servers, search])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索 MCP 服务器..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
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

              <JsonEditor
                className="border rounded-md overflow-hidden font-mono text-xs"
                value={jsonInput}
                onChange={(v) => { setJsonInput(v); setJsonError('') }}
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

      {/* Server list */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">加载中...</div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <ServerIcon className="size-8 opacity-40" />
            <p className="text-sm">
              {search ? "没有匹配的服务器" : "尚未配置任何 MCP 服务器"}
            </p>
            <div className="flex flex-col items-center gap-1 text-xs">
              <p>1. 前往 <a className="text-primary underline" href="https://mcp.so" target="_blank" rel="noreferrer">mcp.so</a> 浏览可用服务器</p>
              <p>2. 复制 Server Config 中的 JSON 配置</p>
              <p>3. 点击"粘贴配置"按钮添加</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredServers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                onDelete={() => handleDelete(server.name)}
                onTest={() => handleTest(server.name)}
                onEdit={() => handleEdit(server)}
                isTesting={isTesting === server.name}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editForm} onOpenChange={(open) => { if (!open) { setEditServer(null); setEditForm(null); setEditError('') } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑 MCP 服务器</DialogTitle>
            <DialogDescription>
              直接编辑 JSON 配置，保存后将以新配置重新写入文件。
            </DialogDescription>
          </DialogHeader>

          <JsonEditor
            className="border rounded-md overflow-hidden font-mono text-xs min-h-[320px]"
            value={editForm ? JSON.stringify({
              mcpServers: {
                [editForm.name]: editForm.transportType === 'stdio'
                  ? {
                      command: editForm.command,
                      args: editForm.args ? editForm.args.split(/\s+/).filter(Boolean) : [],
                      ...(editForm.env ? JSON.parse(editForm.env) : {}),
                    }
                  : {
                      url: editForm.url,
                      ...(editForm.headers ? JSON.parse(editForm.headers) : {}),
                    },
              },
            }, null, 2) : ''}
            onChange={(v) => {
              // 编辑中仅静默更新 editForm，不显示错误
              // 非法 JSON 期间保留上次有效状态，保存时再验证
              try {
                const parsed = JSON.parse(v)
                const blocks = parsed.mcpServers ?? parsed
                const entries = Object.entries(blocks)
                if (entries.length > 0) {
                  const [name, block] = entries[0]
                  const b = block as Record<string, unknown>
                  const hasCommand = 'command' in b
                  setEditForm({
                    ...editForm!,
                    name,
                    transportType: hasCommand ? 'stdio' : 'sse',
                    command: hasCommand ? String(b.command) : '',
                    args: hasCommand && Array.isArray(b.args) ? b.args.join(' ') : '',
                    env: hasCommand && b.env ? JSON.stringify(b.env, null, 2) : '',
                    url: !hasCommand ? String(b.url ?? '') : '',
                    headers: !hasCommand && b.headers ? JSON.stringify(b.headers, null, 2) : '',
                  })
                  setEditError('')
                }
              } catch {
                // JSON 不完整期间，静默忽略
              }
            }}
          />

          {editError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircleIcon className="size-4" />
              {editError}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditServer(null); setEditForm(null); setEditError('') }}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} disabled={!!editError}>
              <CheckIcon className="size-4" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ServerCard({
  server,
  onDelete,
  onTest,
  onEdit,
  isTesting,
}: {
  server: McpServerView
  onDelete: () => void
  onTest: () => void
  onEdit: () => void
  isTesting: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState(false)

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
          <Button variant="ghost" size="sm" onClick={onEdit} title="编辑">
            <PencilIcon className="size-3" />
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
        {server.autoConnect === false ? (
          <Badge variant="secondary" className="text-xs text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800">
            手动连接
          </Badge>
        ) : server.alwaysLoad ? (
          <Badge variant="secondary" className="text-xs text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800">
            启动加载
          </Badge>
        ) : null}
        {server.connectionTimeout && server.connectionTimeout !== 10000 && (
          <span className="text-xs">超时: {server.connectionTimeout}ms</span>
        )}
        {server.transportType === 'stdio' && server.command && (
          <span className="truncate max-w-[300px]">{server.command} {server.args}</span>
        )}
        {(server.transportType === 'sse' || server.transportType === 'http') && server.url && (
          <span className="truncate max-w-[300px]">{server.url}</span>
        )}
      </div>

      {server.error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircleIcon className="size-3" />
          <span className="truncate">{server.error}</span>
        </div>
      )}

      {server.tools.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setToolsExpanded(!toolsExpanded)}
          >
            {toolsExpanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
            <span>{server.toolCount} 个工具</span>
          </button>

          {toolsExpanded && (
            <div className="mt-2 space-y-1.5">
              {server.tools.map((tool) => (
                <div key={tool.name} className="flex items-start gap-2 text-xs">
                  <Badge variant="secondary" className="shrink-0 font-mono text-xs mt-px">
                    {tool.name}
                  </Badge>
                  {tool.description && (
                    <span className="text-muted-foreground line-clamp-2 min-w-0">
                      {tool.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
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

// ============================================================
// JsonEditor — 可编辑的 JSON 编辑器（CodeMirror）
// ============================================================

const lightJsonTheme = EditorView.theme({
  "&": { backgroundColor: "#ffffff", color: "#1a1a1a" },
  ".cm-gutters": { backgroundColor: "#f8f8f8", color: "#999", borderRight: "1px solid #e5e5e5" },
  ".cm-activeLine": { backgroundColor: "#f5f5f5" },
  ".cm-activeLineGutter": { backgroundColor: "#f0f0f0" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#d4d4d4" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#1a1a1a" },
  ".cm-foldPlaceholder": { backgroundColor: "#e5e5e5", border: "none", color: "#666" },
  "&.cm-editor.cm-focused": { outline: "none" },
}, { dark: false })

function JsonEditor({ value, onChange, placeholder: ph, className }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { theme } = useTheme()
  const isDark = theme === "dark"
  const themeCompartment = useRef(new Compartment())

  useEffect(() => {
    if (!containerRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString())
      }
    })

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...lintKeymap,
        ]),
        syntaxHighlighting(defaultHighlightStyle),
        json(),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        updateListener,
        themeCompartment.current.of(isDark ? oneDark : lightJsonTheme),
      ],
    })

    viewRef.current = new EditorView({ state, parent: containerRef.current })

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
    // 只在首次挂载时创建编辑器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 同步外部 value 变化
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    }
  }, [value])

  // 同步主题变化
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(isDark ? oneDark : lightJsonTheme),
    })
  }, [isDark])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ minHeight: "240px" }}
    />
  )
}