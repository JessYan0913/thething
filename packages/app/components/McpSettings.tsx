import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view"
import { EditorState, Compartment } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { lintGutter, linter } from "@codemirror/lint"
import { json, jsonParseLinter } from "@codemirror/lang-json"
import { oneDark } from "@codemirror/theme-one-dark"
import {
  PlusIcon, RefreshCwIcon, ServerIcon, TrashIcon,
  AlertCircleIcon, CodeIcon, MoreVerticalIcon, SearchIcon,
  TerminalIcon, GlobeIcon, WifiIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog"

// ============================================================
// Types
// ============================================================

interface McpServerView {
  name: string
  transportType: "stdio" | "sse" | "http" | "streamable-http"
  command: string
  args: string
  env: string
  url: string
  headers: string
  enabled: boolean
  autoConnect?: boolean
  alwaysLoad?: boolean
  connectionTimeout?: number
  status: "connected" | "disconnected" | "error"
  toolCount: number
  tools: Array<{ name: string; description?: string }>
  error: string | null
}

// ============================================================
// Transformers
// ============================================================

function configToView(config: Record<string, unknown>, snapshotEntry?: {
  connected: boolean
  toolCount: number
  tools?: Array<{ name: string; description?: string }>
  error?: string
}): McpServerView {
  const transport = config.transport as Record<string, unknown> | undefined
  const rawType = transport?.type ?? "stdio"
  const type = ["stdio", "sse", "http", "streamable-http"].includes(rawType as string)
    ? (rawType as McpServerView["transportType"])
    : "stdio"
  return {
    name: (config.name ?? "") as string,
    transportType: type,
    command: type === "stdio" ? ((transport?.command ?? "") as string) : "",
    args: type === "stdio" && transport?.args ? (transport.args as string[]).join(" ") : "",
    env: type === "stdio" && transport?.env ? JSON.stringify(transport.env, null, 2) : "",
    url: ["sse", "http", "streamable-http"].includes(type) ? ((transport?.url ?? "") as string) : "",
    headers: ["sse", "http", "streamable-http"].includes(type) && transport?.headers
      ? JSON.stringify(transport.headers, null, 2)
      : "",
    enabled: (config.enabled ?? true) as boolean,
    autoConnect: config.autoConnect as boolean | undefined,
    alwaysLoad: config.alwaysLoad as boolean | undefined,
    connectionTimeout: config.connectionTimeout as number | undefined,
    status: snapshotEntry ? (snapshotEntry.connected ? "connected" : "error") : "disconnected",
    toolCount: snapshotEntry?.toolCount ?? 0,
    tools: snapshotEntry?.tools ?? [],
    error: snapshotEntry?.error ?? null,
  }
}

// ============================================================
// Sub-components
// ============================================================

const TRANSPORT_LABELS: Record<string, string> = {
  stdio: "Stdio",
  sse: "SSE",
  http: "HTTP",
  "streamable-http": "Streamable HTTP",
}

const TRANSPORT_ICONS: Record<string, React.ReactNode> = {
  stdio: <TerminalIcon className="size-3" />,
  sse: <WifiIcon className="size-3" />,
  http: <GlobeIcon className="size-3" />,
  "streamable-http": <GlobeIcon className="size-3" />,
}

function StatusBadge({ status }: { status: McpServerView["status"] }) {
  switch (status) {
    case "connected":
      return <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25 text-xs">已连接</Badge>
    case "error":
      return <Badge variant="destructive" className="text-xs">错误</Badge>
    case "disconnected":
      return <Badge variant="secondary" className="text-xs">未连接</Badge>
  }
}

// ============================================================
// ServerCard — 列表卡片
// ============================================================

function ServerCard({
  server,
  onClick,
  onDelete,
  onTest,
  isTesting,
}: {
  server: McpServerView
  onClick: () => void
  onDelete: () => void
  onTest: () => void
  isTesting: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={`rounded-lg border p-4 transition-colors relative ${
      server.enabled
        ? "hover:border-accent/50 hover:bg-accent/20"
        : "opacity-60 border-dashed"
    }`}>
      <div className="flex items-start justify-between gap-4 min-w-0">
        <button
          onClick={onClick}
          className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer"
        >
          <ServerIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-medium text-sm truncate">{server.name}</span>
              <StatusBadge status={server.status} />
              <Badge variant="secondary" className="text-[10px] font-normal flex items-center gap-1">
                {TRANSPORT_ICONS[server.transportType]}
                {TRANSPORT_LABELS[server.transportType] ?? server.transportType}
              </Badge>
            </div>
            {server.error && (
              <p className="text-xs text-destructive line-clamp-1">{server.error}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-1">
              {server.autoConnect === false && (
                <Badge variant="secondary" className="text-[10px] font-normal text-amber-600 dark:text-amber-400">
                  手动连接
                </Badge>
              )}
              {server.alwaysLoad && (
                <Badge variant="secondary" className="text-[10px] font-normal text-blue-600 dark:text-blue-400">
                  启动加载
                </Badge>
              )}
              {server.toolCount > 0 && (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {server.toolCount} 个工具
                </Badge>
              )}
              {server.transportType === "stdio" && server.command && (
                <span className="truncate max-w-75 text-[10px] font-mono">{server.command} {server.args}</span>
              )}
              {["sse", "http", "streamable-http"].includes(server.transportType) && server.url && (
                <span className="truncate max-w-75 text-[10px] font-mono">{server.url}</span>
              )}
            </div>
          </div>
        </button>

        {/* Actions menu */}
        <div className="relative shrink-0 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-7"
            onClick={(e) => { e.stopPropagation(); onTest() }}
            disabled={isTesting}
          >
            <RefreshCwIcon className={`size-3.5 ${isTesting ? "animate-spin" : ""}`} />
          </Button>
          <div className="relative">
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
    </div>
  )
}

// ============================================================
// JsonEditor — CodeMirror JSON 编辑器（用于导入对话框）
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

function JsonEditor({ value, onChange, showLint, className }: {
  value: string
  onChange: (value: string) => void
  showLint?: boolean
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

    const extensions = [
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
      ]),
      syntaxHighlighting(defaultHighlightStyle),
      json(),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      updateListener,
      themeCompartment.current.of(isDark ? oneDark : lightJsonTheme),
    ]

    if (showLint) {
      extensions.push(lintGutter())
      extensions.push(linter(jsonParseLinter(), { delay: 300 }))
    }

    const state = EditorState.create({ doc: value, extensions })
    viewRef.current = new EditorView({ state, parent: containerRef.current })

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(isDark ? oneDark : lightJsonTheme),
    })
  }, [isDark])

  return (
    <div ref={containerRef} className={className} style={{ minHeight: "280px" }} />
  )
}

// ============================================================
// 主组件
// ============================================================

export default function McpSettingsPage() {
  const router = useRouter()
  const [servers, setServers] = useState<McpServerView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [isTesting, setIsTesting] = useState<string | null>(null)
  const [jsonInput, setJsonInput] = useState("")
  const [jsonError, setJsonError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<McpServerView | null>(null)

  const loadServers = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/mcp")
      if (res.ok) {
        const data = await res.json()
        const configs = (data.servers ?? []) as Record<string, unknown>[]
        const snapshotServers = (data.snapshot?.servers ?? []) as Array<{
          name: string
          connected: boolean
          toolCount: number
          tools?: Array<{ name: string; description?: string }>
          error?: string
        }>
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

  useEffect(() => {
    const hasDisconnected = servers.some(s => s.status === "disconnected" || s.status === "error")
    if (!hasDisconnected) return
    const interval = setInterval(loadServers, 5000)
    return () => clearInterval(interval)
  }, [servers, loadServers])

  const handleJsonImport = useCallback(async () => {
    setJsonError("")
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonInput)
    } catch {
      setJsonError("JSON 格式错误，请检查")
      return
    }

    if (typeof parsed.name === "string" && parsed.transport && typeof parsed.transport === "object" && "type" in (parsed.transport as object)) {
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        })
        if (res.ok) {
          setJsonInput("")
          await loadServers()
        } else {
          const err = await res.json()
          setJsonError(err.error ?? "添加失败")
        }
      } catch {
        setJsonError("网络错误，请重试")
      }
      return
    }

    const serverBlocks: Record<string, Record<string, unknown>> =
      parsed.mcpServers && typeof parsed.mcpServers === "object"
        ? parsed.mcpServers as Record<string, Record<string, unknown>>
        : parsed as Record<string, Record<string, unknown>>

    const entries = Object.entries(serverBlocks)
    if (entries.length === 0) {
      setJsonError("未找到任何服务器配置")
      return
    }

    let added = 0
    let failed = 0
    const results = await Promise.all(
      entries.map(async ([name, block]) => {
        const dotTransport = typeof block.transport === "string" ? (block.transport as string) : null
        const isStdio = !!(block.command) || dotTransport === "stdio"

        let transport: Record<string, unknown>
        if (isStdio) {
          transport = {
            type: "stdio",
            command: String(block.command ?? ""),
            args: Array.isArray(block.args) ? block.args : [],
            ...(block.env ? { env: block.env } : {}),
          }
        } else {
          const tType = (dotTransport === "http" || dotTransport === "streamable-http") ? dotTransport : "sse"
          transport = {
            type: tType,
            url: String(block.url ?? ""),
            ...(block.headers ? { headers: block.headers } : {}),
          }
        }

        try {
          const res = await fetch("/api/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
      setJsonInput("")
      await loadServers()
    }
    if (failed > 0) {
      setJsonError(`${failed} 个服务器添加失败（可能已存在）`)
    }
  }, [jsonInput, loadServers])

  const handleDelete = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/mcp?name=${encodeURIComponent(name)}`, { method: "DELETE" })
      if (res.ok) setServers((prev) => prev.filter((s) => s.name !== name))
    } catch { /* ignore */ }
    setConfirmDelete(null)
  }, [])

  const handleTest = useCallback(async (name: string) => {
    setIsTesting(name)
    try {
      const res = await fetch(`/api/mcp?name=${encodeURIComponent(name)}&connect=true`)
      if (res.ok) {
        const data = await res.json()
        const snapshot = data.snapshot as { servers: Array<{
          name: string; connected: boolean; toolCount: number
          tools?: Array<{ name: string; description?: string }>
          error?: string
        }> }
        setServers((prev) =>
          prev.map((s) =>
            s.name === name
              ? {
                  ...s,
                  status: snapshot.servers[0]?.connected ? "connected" : "error",
                  toolCount: snapshot.servers[0]?.toolCount ?? 0,
                  tools: snapshot.servers[0]?.tools ?? [],
                  error: snapshot.servers[0]?.error ?? null,
                }
              : s,
          ),
        )
      }
    } catch {
      setServers((prev) => prev.map((s) => s.name === name ? { ...s, status: "error", error: "连接失败" } : s))
    } finally {
      setIsTesting(null)
    }
  }, [])

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
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
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
                编辑器会实时检查 JSON 格式，左侧有红色标记时说明格式有误。
              </DialogDescription>
            </DialogHeader>

            <JsonEditor
              className="border rounded-md overflow-hidden font-mono text-xs"
              value={jsonInput}
              onChange={(v) => { setJsonInput(v); setJsonError("") }}
              showLint
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
        ) : filteredServers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <ServerIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">
                {servers.length === 0 ? "尚未配置任何 MCP 服务器" : "没有匹配的服务器"}
              </p>
              {servers.length === 0 && (
                <div className="flex flex-col items-center gap-1 text-xs">
                  <p>1. 前往 <a className="text-primary underline" href="https://mcp.so" target="_blank" rel="noreferrer">mcp.so</a> 浏览可用服务器</p>
                  <p>2. 复制 Server Config 中的 JSON 配置</p>
                  <p>3. 点击「粘贴配置」按钮添加</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
            {filteredServers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                onClick={() => router.push(`/settings/mcp/${encodeURIComponent(server.name)}`)}
                onDelete={() => setConfirmDelete(server)}
                onTest={() => handleTest(server.name)}
                isTesting={isTesting === server.name}
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
                确定要删除 MCP 服务器 &ldquo;{confirmDelete.name}&rdquo; 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(confirmDelete.name)}>
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
