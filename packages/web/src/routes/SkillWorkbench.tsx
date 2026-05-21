import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { nanoid } from "nanoid"
import {
  ArrowLeftIcon, FolderIcon, SparklesIcon, FileTextIcon, RefreshCwIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { SkillFileTree, type SkillFileNode } from "@/components/SkillFileTree"
import Chat from "@/components/Chat"
import {
  EditorView,
  keymap,
  placeholder,
} from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { defaultKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { css } from "@codemirror/lang-css"
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

const languageLoaders: Record<string, (() => import("@codemirror/language").LanguageSupport) | undefined> = {
  md: () => markdown(),
  mdx: () => markdown(),
  json: () => json(),
  yaml: () => yaml(),
  yml: () => yaml(),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  py: () => python(),
  css: () => css(),
}

function getExt(filePath: string): string {
  const parts = filePath.split(".")
  if (parts.length > 1) return parts[parts.length - 1].toLowerCase()
  return ""
}

export default function SkillWorkbench() {
  const navigate = useNavigate()
  const conversationId = useMemo(() => nanoid(), [])

  const [skillName, setSkillName] = useState<string | null>(null)
  const [tree, setTree] = useState<SkillFileNode[] | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // 注册工作台会话到 server
  useEffect(() => {
    fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: conversationId, title: "Skill Workbench" }),
    }).catch(() => {})
  }, [conversationId])

  const refreshSkillFiles = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/skills/detail?name=${encodeURIComponent(name)}`)
      if (!res.ok) return
      const data = await res.json()
      setTree(data.tree ?? [])
      if (!selectedFilePath && data.skillMdPath) {
        setSelectedFilePath(data.skillMdPath)
      }
    } catch {
      // ignore
    }
  }, [selectedFilePath])

  const handleTurnFinish = useCallback(async () => {
    try {
      // 检测最近修改的 skill
      const detectRes = await fetch("/api/skill-workbench/detect")
      if (!detectRes.ok) return
      const { skillName: detected } = await detectRes.json()

      if (detected) {
        setSkillName(detected)
        await refreshSkillFiles(detected)
      }
    } catch {
      // ignore
    }
  }, [refreshSkillFiles])

  // 加载文件内容
  useEffect(() => {
    if (!selectedFilePath || !skillName) return
    setFileLoading(true)
    fetch(`/api/skills/file?name=${encodeURIComponent(skillName)}&path=${encodeURIComponent(selectedFilePath)}`)
      .then((res) => res.json())
      .then((data) => setFileContent(data.content ?? null))
      .catch(() => setFileContent(null))
      .finally(() => setFileLoading(false))
  }, [selectedFilePath, skillName])

  // CodeMirror 渲染
  useEffect(() => {
    if (!editorRef.current || !fileContent) return
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const detected = getExt(selectedFilePath ?? "")
    const loadLang = languageLoaders[detected]
    const langExtension = loadLang ? loadLang() : []

    const state = EditorState.create({
      doc: fileContent,
      extensions: [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
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
        placeholder(""),
        EditorView.theme({
          "&": { fontSize: "13px" },
          ".cm-scroller": { fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace' },
          ".cm-content": { caretColor: "transparent" },
          ".cm-cursor": { borderLeftColor: "transparent" },
          ".cm-foldGutter .cm-gutterElement": { cursor: "pointer" },
          "&.cm-editor.cm-focused": { outline: "none" },
        }),
        oneDark,
        langExtension,
      ],
    })

    viewRef.current = new EditorView({ state, parent: editorRef.current })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [fileContent, selectedFilePath])

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/settings/skills")}>
            <ArrowLeftIcon className="size-4 mr-1" />
            返回
          </Button>
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" />
            <span className="text-sm font-medium">Skill 工作台</span>
            {skillName && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {skillName}
              </span>
            )}
          </div>
        </div>
        {skillName && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refreshSkillFiles(skillName)}
          >
            <RefreshCwIcon className="size-4" />
          </Button>
        )}
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: File Tree */}
        <div className="w-60 border-r flex flex-col shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/20">
            <FolderIcon className="size-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {skillName ?? "等待生成..."}
            </span>
          </div>
          <div className="flex-1 overflow-auto font-mono text-sm">
            {tree && tree.length > 0 ? (
              <SkillFileTree
                nodes={tree}
                selectedPath={selectedFilePath}
                onSelect={setSelectedFilePath}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 text-xs gap-2 px-4 text-center">
                <FileTextIcon className="size-8 opacity-30" />
                <p>在右侧对话中描述你想创建的 Skill，文件将在这里显示</p>
              </div>
            )}
          </div>
        </div>

        {/* Middle: File Preview */}
        <div className="flex-1 overflow-hidden flex flex-col min-w-0">
          {fileLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
              加载中...
            </div>
          ) : fileContent ? (
            <div className="flex flex-col h-full">
              {selectedFilePath && (
                <div className="flex items-center justify-between px-4 py-1.5 border-b bg-muted/20 shrink-0">
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {selectedFilePath}
                  </span>
                  <span className="text-xs text-muted-foreground/50 font-mono">.{getExt(selectedFilePath)}</span>
                </div>
              )}
              <div ref={editorRef} className="overflow-auto flex-1" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
              选择左侧文件以预览内容
            </div>
          )}
        </div>

        {/* Right: Chat */}
        <div className="w-[420px] border-l flex flex-col shrink-0">
          <Chat
            conversationId={conversationId}
            apiEndpoint="/api/skill-workbench/chat"
            onTurnFinish={handleTurnFinish}
          />
        </div>
      </div>
    </div>
  )
}
