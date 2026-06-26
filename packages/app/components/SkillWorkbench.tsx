import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useParams } from "next/navigation"
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
import { EditorState, Compartment } from "@codemirror/state"
import { defaultKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { css } from "@codemirror/lang-css"
import { useDarkMode, createThemeCompartment, getCodeMirrorTheme } from "@/lib/codemirror-theme"
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
  const router = useRouter()
  const { skillName: editSkillName } = useParams<{ skillName?: string }>()
  const isEditing = !!editSkillName

  const conversationId = useMemo(() => nanoid(), [])
  const pageLoadTime = useMemo(() => Date.now(), [])

  const [skillName, setSkillName] = useState<string | null>(editSkillName ?? null)
  const [tree, setTree] = useState<SkillFileNode[] | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langCompartment = useRef(new Compartment())
  const themeCompartment = useRef(createThemeCompartment())
  const isDarkMode = useDarkMode()

  // 编辑模式：初始加载已有 skill 文件
  useEffect(() => {
    if (!editSkillName) return
    refreshSkillFiles(editSkillName)
  }, [editSkillName])

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
      const detectRes = await fetch(`/api/skill-workbench/detect?since=${pageLoadTime}`)
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

    const detected = getExt(selectedFilePath ?? "")
    const loadLang = languageLoaders[detected]
    const langExtension = loadLang ? loadLang() : []

    if (viewRef.current) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: fileContent },
        effects: langCompartment.current.reconfigure(langExtension),
      })
      return
    }

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
        themeCompartment.current.of(getCodeMirrorTheme(isDarkMode)),
        langCompartment.current.of(langExtension),
      ],
    })

    viewRef.current = new EditorView({ state, parent: editorRef.current })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContent, selectedFilePath])

  // 响应主题变化，动态切换 CodeMirror 亮/暗主题
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(getCodeMirrorTheme(isDarkMode)),
    })
  }, [isDarkMode])

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/settings/skills")}>
            <ArrowLeftIcon className="size-4 mr-1" />
            返回
          </Button>
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" />
            <span className="text-sm font-medium">
              {isEditing ? "Skill 编辑" : "Skill 工作台"}
            </span>
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
                <p>{isEditing ? "加载中..." : "在右侧对话中描述你想创建的 Skill，文件将在这里显示"}</p>
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
        <div className="w-[26.25rem] border-l flex flex-col shrink-0 min-h-0">
          <Chat
            conversationId={conversationId}
            apiEndpoint="/api/skill-workbench"
            onTurnFinish={handleTurnFinish}
            extraBody={editSkillName ? { editSkillName } : undefined}
          />
        </div>
      </div>
    </div>
  )
}
