'use client'

import { useCallback, useEffect, useRef, useState } from "react"
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
  ArrowLeftIcon, RefreshCwIcon, ServerIcon, TrashIcon,
  CheckIcon, AlertCircleIcon, TerminalIcon, GlobeIcon, WifiIcon,
  ChevronDownIcon, ChevronRightIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DetailPageHeader, type MenuItem } from "@/components/ui/detail-page-header"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"

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

function serverToEditJson(server: McpServerView): string {
  const entry: Record<string, unknown> = {}

  if (server.transportType === "stdio") {
    entry.command = server.command
    if (server.args.trim()) {
      entry.args = server.args.trim().split(/\s+/).filter(Boolean)
    }
    if (server.env.trim()) {
      try { entry.env = JSON.parse(server.env) } catch { entry.env = server.env }
    }
    entry.transport = "stdio"
  } else {
    entry.url = server.url
    if (server.headers.trim()) {
      try { entry.headers = JSON.parse(server.headers) } catch { entry.headers = server.headers }
    }
    entry.transport = server.transportType
  }

  if (server.enabled === false) entry.enabled = false
  if (server.autoConnect === false) entry.autoConnect = false
  if (server.alwaysLoad) entry.alwaysLoad = true
  if (server.connectionTimeout && server.connectionTimeout !== 10000) {
    entry.connectionTimeout = server.connectionTimeout
  }

  return JSON.stringify({ mcpServers: { [server.name]: entry } }, null, 2)
}

function extractServerFromJson(jsonStr: string): {
  name: string
  transport: Record<string, unknown>
  enabled: boolean
} | { error: string } {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return { error: "JSON 格式错误" }
  }

  if (typeof parsed.name === "string" && parsed.transport && typeof parsed.transport === "object" && "type" in (parsed.transport as object)) {
    const t = parsed.transport as Record<string, unknown>
    return {
      name: parsed.name as string,
      transport: t,
      enabled: (parsed.enabled as boolean) ?? true,
    }
  }

  const serverBlocks: Record<string, Record<string, unknown>> =
    parsed.mcpServers && typeof parsed.mcpServers === "object"
      ? parsed.mcpServers as Record<string, Record<string, unknown>>
      : parsed as Record<string, Record<string, unknown>>

  const entries = Object.entries(serverBlocks)
  if (entries.length === 0) return { error: "未找到服务器配置" }
  if (entries.length > 1) return { error: "一次只能编辑一个服务器，请移除多余的配置" }

  const [name, block] = entries[0] as [string, Record<string, unknown>]
  if (!name.trim()) return { error: "服务器名称不能为空" }

  const dotTransport = typeof block.transport === "string" ? (block.transport as string) : null
  const isStdio = !!(block.command) || dotTransport === "stdio"
  const isValidUrl = !isStdio && !!(block.url)

  if (!isStdio && !isValidUrl) {
    return { error: "Stdio 配置需要 command，HTTP/SSE 配置需要 url" }
  }

  let transport: Record<string, unknown>
  if (isStdio) {
    transport = {
      type: "stdio",
      command: String(block.command ?? ""),
      args: Array.isArray(block.args) ? block.args : [],
    }
    if (block.env) transport.env = block.env
  } else {
    const tType = (dotTransport === "http" || dotTransport === "streamable-http") ? dotTransport : "sse"
    transport = {
      type: tType,
      url: String(block.url ?? ""),
    }
    if (block.headers) transport.headers = block.headers
  }

  return {
    name,
    transport,
    enabled: block.enabled !== false,
  }
}

// ============================================================
// JsonEditor — CodeMirror JSON 编辑器
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
// McpDetail — 详情/编辑页面组件
// ============================================================

export default function McpDetail({
  serverName,
  onBack,
}: {
  serverName: string
  onBack: () => void
}) {
  const [server, setServer] = useState<McpServerView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editJsonValue, setEditJsonValue] = useState("")
  const [editJsonError, setEditJsonError] = useState("")
  const [editApiError, setEditApiError] = useState("")
  const [saving, setSaving] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const loadServer = useCallback(async () => {
    setIsLoading(true)
    setError(null)
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
        const found = configs.find((c) => c.name === serverName)
        if (found) {
          const snapshot = snapshotServers.find((s) => s.name === serverName)
          const view = configToView(found, snapshot)
          setServer(view)
          setEditJsonValue(serverToEditJson(view))
        } else {
          setError("服务器不存在")
        }
      }
    } catch {
      setError("加载失败")
    } finally {
      setIsLoading(false)
    }
  }, [serverName])

  useEffect(() => { loadServer() }, [loadServer])

  const handleJsonChange = useCallback((value: string) => {
    setEditJsonValue(value)
    try {
      JSON.parse(value)
      setEditJsonError("")
    } catch {
      if (value.trim()) {
        setEditJsonError("JSON 格式有误，请检查编辑器中红色标记处")
      } else {
        setEditJsonError("")
      }
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (!server) return
    setEditApiError("")

    const extracted = extractServerFromJson(editJsonValue)
    if ("error" in extracted) {
      setEditJsonError(extracted.error)
      return
    }

    const { name, transport, enabled } = extracted
    const nameChanged = name !== server.name

    setSaving(true)
    try {
      if (nameChanged) {
        await fetch(`/api/mcp?name=${encodeURIComponent(server.name)}`, { method: "DELETE" })
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, transport, enabled }),
        })
        if (!res.ok) {
          const err = await res.json()
          setEditApiError(err.error ?? "保存失败")
          return
        }
      } else {
        const res = await fetch(`/api/mcp?name=${encodeURIComponent(name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transport, enabled }),
        })
        if (!res.ok) {
          const err = await res.json()
          setEditApiError(err.error ?? "保存失败")
          return
        }
      }
      onBack()
    } catch {
      setEditApiError("网络错误，请重试")
    } finally {
      setSaving(false)
    }
  }, [server, editJsonValue, onBack])

  const handleDelete = useCallback(async () => {
    if (!server) return
    try {
      const res = await fetch(`/api/mcp?name=${encodeURIComponent(server.name)}`, { method: "DELETE" })
      if (res.ok) onBack()
    } catch { /* ignore */ }
  }, [server, onBack])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        加载中...
      </div>
    )
  }

  if (error || !server) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <ServerIcon className="size-12 opacity-20" />
        <p className="text-sm">{error || "服务器不存在"}</p>
        <Button size="sm" onClick={onBack}>返回</Button>
      </div>
    )
  }

  const menuItems: MenuItem[] = [
    {
      label: "刷新",
      icon: <RefreshCwIcon className="size-3.5" />,
      onClick: loadServer,
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
        icon={<ServerIcon />}
        title={server.name}
        badges={
          <>
            <StatusBadge status={server.status} />
            <Badge variant="secondary" className="text-xs flex items-center gap-1">
              {TRANSPORT_ICONS[server.transportType]}
              {TRANSPORT_LABELS[server.transportType] ?? server.transportType}
            </Badge>
          </>
        }
        onSave={handleSave}
        saving={saving}
        saveDisabled={!!editJsonError}
        menuItems={menuItems}
      />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto p-6 space-y-6">
        {/* Server info */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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
            {server.transportType === "stdio" && server.command && (
              <span className="font-mono truncate max-w-75">{server.command} {server.args}</span>
            )}
            {["sse", "http", "streamable-http"].includes(server.transportType) && server.url && (
              <span className="font-mono truncate max-w-75">{server.url}</span>
            )}
          </div>

          {server.error && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircleIcon className="size-3 shrink-0" />
              <span className="truncate">{server.error}</span>
            </div>
          )}
        </div>

        {/* JSON Editor */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">配置编辑</h3>
          <div className="border rounded-md overflow-hidden">
            <JsonEditor
              className="font-mono text-xs min-h-80"
              value={editJsonValue}
              onChange={handleJsonChange}
              showLint
            />
          </div>

          {editJsonError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircleIcon className="size-4 shrink-0" />
              {editJsonError}
            </div>
          )}

          {editApiError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-md px-3 py-2">
              <AlertCircleIcon className="size-4 shrink-0" />
              {editApiError}
            </div>
          )}
        </div>

        {/* Tools list */}
        {server.tools.length > 0 && (
          <div className="space-y-3">
            <button
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setToolsExpanded(!toolsExpanded)}
            >
              {toolsExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
              <span>已发现 {server.toolCount} 个工具</span>
            </button>

            {toolsExpanded && (
              <div className="space-y-1.5 pl-5">
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

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDelete}
        itemName={server.name}
      />
    </div>
  )
}
