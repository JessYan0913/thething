import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { nanoid } from "nanoid"
import {
  ArrowLeftIcon, SaveIcon, BotIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Chat from "@/components/Chat"
import type { UIMessage } from "ai"

import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
} from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { defaultKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { oneDark } from "@codemirror/theme-one-dark"
import {
  indentOnInput,
  foldGutter,
  indentUnit,
} from "@codemirror/language"
import { searchKeymap } from "@codemirror/search"
import {
  closeBrackets,
  autocompletion,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete"
import { lintKeymap } from "@codemirror/lint"

const BLANK_TEMPLATE = `---
agentType: ""
description: ""
model: inherit
effort: medium
maxTurns: 20
tools: []
skills: []
---

`

function extractAgentType(content: string): string {
  const match = content.match(/agentType:\s*["']?([^\s"'\n]+)/)
  return match?.[1] ?? ""
}

function extractAgentConfigContent(text: string): string | null {
  const match = text.match(/<agent-config>([\s\S]*?)<\/agent-config>/)
  if (!match) return null
  return match[1].trim()
}

export default function AgentWorkbench() {
  const navigate = useNavigate()
  const { agentType: editAgentType } = useParams<{ agentType?: string }>()
  const isEditing = !!editAgentType

  const [content, setContent] = useState(BLANK_TEMPLATE)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("config")
  const [loaded, setLoaded] = useState(!isEditing)

  const configConversationId = useMemo(() => nanoid(), [])
  const [debugConversationId, setDebugConversationId] = useState(() => nanoid())
  const prevTabRef = useRef(activeTab)
  const knownAgentTypesRef = useRef<Set<string>>(new Set())

  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const contentRef = useRef(content)

  // Snapshot existing agents on mount for new-agent detection
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const types = (data.agents ?? []).map((a: { agentType: string }) => a.agentType)
        knownAgentTypesRef.current = new Set(types)
      })
      .catch(() => {})
  }, [])

  // Load existing agent content when editing
  useEffect(() => {
    if (!editAgentType) return
    fetch(`/api/agents/${encodeURIComponent(editAgentType)}/content`)
      .then((r) => r.json())
      .then((data) => {
        if (data.content) setContent(data.content)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [editAgentType])

  // Reset debug conversationId when switching from config to debug
  useEffect(() => {
    if (prevTabRef.current === "config" && activeTab === "debug") {
      setDebugConversationId(nanoid())
    }
    prevTabRef.current = activeTab
  }, [activeTab])

  // CodeMirror editor
  useEffect(() => {
    if (!editorRef.current || !loaded) return
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        keymap.of([
          ...defaultKeymap,
          ...searchKeymap,
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...lintKeymap,
        ]),
        closeBrackets(),
        autocompletion(),
        indentOnInput(),
        foldGutter(),
        indentUnit.of("  "),
        cmPlaceholder("编写 Agent 配置文档（YAML frontmatter + markdown 指令）..."),
        EditorView.theme({
          "&": { fontSize: "13px", height: "100%" },
          ".cm-scroller": {
            fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace',
            overflow: "auto",
          },
          ".cm-foldGutter .cm-gutterElement": { cursor: "pointer" },
          "&.cm-editor.cm-focused": { outline: "none" },
          "&.cm-editor": { height: "100%" },
        }),
        oneDark,
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const val = update.state.doc.toString()
            contentRef.current = val
            setContent(val)
          }
        }),
      ],
    })

    viewRef.current = new EditorView({ state, parent: editorRef.current })
    contentRef.current = content

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // Sync external content changes (from AI config apply) into CodeMirror
  const lastAppliedContentRef = useRef(content)
  useEffect(() => {
    if (!viewRef.current) return
    if (content !== lastAppliedContentRef.current && content !== contentRef.current) {
      const view = viewRef.current
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      })
      contentRef.current = content
    }
    lastAppliedContentRef.current = content
  }, [content])

  const handleSave = useCallback(async () => {
    const agentType = extractAgentType(content)
    if (!agentType) {
      setSaveMsg("文档中缺少 agentType 字段")
      return
    }
    setSaving(true)
    setSaveMsg(null)
    try {
      if (isEditing) {
        const res = await fetch(`/api/agents/${encodeURIComponent(editAgentType!)}/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        })
        if (res.ok) {
          setSaveMsg("保存成功")
        } else {
          const data = await res.json().catch(() => ({}))
          setSaveMsg(data.error ?? "保存失败")
        }
      } else {
        const res = await fetch("/api/agents/from-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentType, content }),
        })
        if (res.ok) {
          setSaveMsg("创建成功")
          navigate(`/agent-workbench/${agentType}`, { replace: true })
        } else {
          const data = await res.json().catch(() => ({}))
          setSaveMsg(data.error ?? "创建失败")
        }
      }
    } catch {
      setSaveMsg("保存失败")
    } finally {
      setSaving(false)
    }
  }, [content, isEditing, editAgentType, navigate])

  // Scan assistant messages for <agent-config> tags after each turn
  const handleConfigTurnFinish = useCallback(async () => {
    const chatEndpoint = "/api/agent-workbench/chat"
    try {
      const r = await fetch(`${chatEndpoint}?conversationId=${encodeURIComponent(configConversationId)}`)
      const data = await r.json()
      const msgs = (data.messages ?? []) as UIMessage[]

      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (msg.role !== "assistant") continue
        for (const part of msg.parts) {
          if (part.type === "text") {
            const extracted = extractAgentConfigContent(part.text)
            if (extracted) {
              setContent(extracted)
              return
            }
          }
        }
      }

      // Fallback: AI may have created a file via tools — detect new agent
      const agentsRes = await fetch("/api/agents")
      if (!agentsRes.ok) return
      const agentsData = await agentsRes.json()
      const allTypes = (agentsData.agents ?? []).map((a: { agentType: string }) => a.agentType) as string[]
      const newTypes = allTypes.filter((t) => !knownAgentTypesRef.current.has(t))

      if (newTypes.length > 0) {
        const newAgentType = newTypes[newTypes.length - 1]
        knownAgentTypesRef.current.add(newAgentType)
        const contentRes = await fetch(`/api/agents/${encodeURIComponent(newAgentType)}/content`)
        if (!contentRes.ok) return
        const contentData = await contentRes.json()
        if (contentData.content) {
          setContent(contentData.content)
        }
      }
    } catch {
      // ignore
    }
  }, [configConversationId])

  const extraBody = useMemo(() => ({ currentContent: content }), [content])

  const displayName = useMemo(() => {
    const at = extractAgentType(content)
    return at || (isEditing ? editAgentType : undefined)
  }, [content, isEditing, editAgentType])

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">
        加载中...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/settings/agents")}>
            <ArrowLeftIcon className="size-4 mr-1" />
            返回
          </Button>
          <div className="flex items-center gap-2">
            <BotIcon className="size-4 text-primary" />
            <span className="text-sm font-medium">Agent 工作台</span>
            {displayName && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {displayName}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="config">配置</TabsTrigger>
              <TabsTrigger value="debug">调试</TabsTrigger>
            </TabsList>
          </Tabs>
          {activeTab === "config" && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <SaveIcon className="size-3.5 mr-1" />
                {saving ? "保存中..." : isEditing ? "保存" : "创建"}
              </Button>
              {saveMsg && (
                <span className={`text-xs ${saveMsg.includes("成功") ? "text-green-600" : "text-destructive"}`}>
                  {saveMsg}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === "config" ? (
          <div className="flex h-full">
            {/* Left: Document Editor */}
            <div className="flex-1 overflow-hidden flex flex-col min-w-0">
              <div ref={editorRef} className="flex-1 overflow-hidden" />
            </div>

            {/* Right: AI Chat */}
            <div className="w-96 border-l flex flex-col shrink-0">
              <Chat
                conversationId={configConversationId}
                apiEndpoint="/api/agent-workbench/chat"
                onTurnFinish={handleConfigTurnFinish}
                extraBody={extraBody}
              />
            </div>
          </div>
        ) : (
          <Chat
            conversationId={debugConversationId}
            apiEndpoint="/api/agent-workbench/debug"
            extraBody={extraBody}
          />
        )}
      </div>
    </div>
  )
}
