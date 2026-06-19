import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  WrenchIcon, FolderIcon,
  ArrowLeftIcon, SparklesIcon,
  FileCodeIcon, XIcon, SendIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SkillFileTree, type SkillFileNode } from "@/components/SkillFileTree"
import { cn } from "@/lib/utils"
import { nanoid } from "nanoid"
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
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
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

// ============================================================
// Types
// ============================================================

export interface SkillView {
  name: string
  folderName: string
  description: string
  whenToUse?: string
  allowedTools: string[]
  model?: string
  effort: "low" | "medium" | "high"
  sourcePath: string
  source: string
  context?: string
  paths?: string[]
}

interface SkillDetailProps {
  skill?: SkillView
  folderName?: string
  onBack?: () => void
  onEdit?: (folderName: string) => void
}

// ============================================================
// Constants
// ============================================================

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

function isMarkdown(filePath: string): boolean {
  const ext = getExt(filePath)
  return ext === "md" || ext === "mdx"
}

function findFirstFile(nodes: SkillFileNode[]): SkillFileNode | null {
  for (const node of nodes) {
    if (node.type === "file") return node
    if (node.children) {
      const found = findFirstFile(node.children)
      if (found) return found
    }
  }
  return null
}

// ============================================================
// Main Component
// ============================================================

export default function SkillDetail({ skill: skillProp, folderName, onBack }: SkillDetailProps) {
  const router = useRouter()

  // ── Skill metadata ───────────────────────────────────────────
  const [skill, setSkill] = useState<SkillView | null>(skillProp ?? null)
  const [skillLoading, setSkillLoading] = useState(!skillProp && !!folderName)

  // ── File browser ─────────────────────────────────────────────
  const [tree, setTree] = useState<SkillFileNode[] | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(true)
  const initialFileRef = useRef<string | null>(null) // tracks the file fetched by the tree effect
  const fetchCtrlRef = useRef<AbortController | null>(null)

  // ── Chat ─────────────────────────────────────────────────────
  const [showChat, setShowChat] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [isCreatingChat, setIsCreatingChat] = useState(false)

  // ── CodeMirror ───────────────────────────────────────────────
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langCompartment = useRef(new Compartment())
  const themeCompartment = useRef(createThemeCompartment())
  const isDarkMode = useDarkMode()

  const skillFolderName = skillProp?.folderName ?? folderName

  // ── 1. Load skill metadata ───────────────────────────────────
  useEffect(() => {
    if (skillProp || !folderName) return
    setSkillLoading(true)
    fetch(`/api/skills?folderName=${encodeURIComponent(folderName)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Skill not found')
        return res.json()
      })
      .then((data) => setSkill(data.skill))
      .catch(() => setSkill(null))
      .finally(() => setSkillLoading(false))
  }, [skillProp, folderName])

  // ── 2. Load tree + default file content ──────────────────────
  useEffect(() => {
    if (!skillFolderName) return
    const ctrl = new AbortController()

    ;(async () => {
      setFileLoading(true)
      setFileContent(null)
      setSelectedFilePath(null)
      setTree(null)

      try {
        // Fetch tree
        const treeRes = await fetch(
          `/api/skills/detail?name=${encodeURIComponent(skillFolderName)}`,
          { signal: ctrl.signal },
        )
        if (ctrl.signal.aborted) return
        const treeData = await treeRes.json()
        setTree(treeData.tree ?? [])

        // Pick default file
        let path: string | null = null
        if (treeData.skillMdPath) {
          path = treeData.skillMdPath
        } else if (treeData.tree?.length > 0) {
          const first = findFirstFile(treeData.tree)
          if (first) path = first.path
        }
        setSelectedFilePath(path)
        initialFileRef.current = path

        // Fetch default file content
        if (path) {
          const fileRes = await fetch(
            `/api/skills/file?name=${encodeURIComponent(skillFolderName)}&path=${encodeURIComponent(path)}`,
            { signal: ctrl.signal },
          )
          if (ctrl.signal.aborted) return
          const fileData = await fileRes.json()
          setFileContent(fileData.content ?? null)
        }
      } catch {
        if (!ctrl.signal.aborted) {
          setTree([])
          setFileContent(null)
        }
      } finally {
        if (!ctrl.signal.aborted) setFileLoading(false)
      }
    })()

    return () => ctrl.abort()
  }, [skillFolderName])

  // ── 3. CodeMirror — single effect: create once, update after ─
  useEffect(() => {
    if (!editorRef.current || fileContent === null) return

    // Skip CodeMirror for markdown files — they use ReactMarkdown instead
    if (isMarkdown(selectedFilePath ?? "")) {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
      return
    }

    const ext = getExt(selectedFilePath ?? "")
    const loadLang = languageLoaders[ext]
    const langExtension = loadLang ? loadLang() : []

    if (viewRef.current) {
      // Editor already exists — update content and language
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: fileContent },
        effects: langCompartment.current.reconfigure(langExtension),
      })
      return
    }

    // First content arrival — create the editor
    const state = EditorState.create({
      doc: fileContent,
      extensions: [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        keymap.of([...defaultKeymap, ...searchKeymap, ...closeBracketsKeymap, ...completionKeymap, ...lintKeymap]),
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

  // ── 4. Theme change ──────────────────────────────────────────
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(getCodeMirrorTheme(isDarkMode)),
    })
  }, [isDarkMode])

  // ── File selection handler ───────────────────────────────────
  const handleSelectFile = useCallback(async (path: string) => {
    // Skip if this is the file already fetched by the tree effect
    if (initialFileRef.current === path) {
      initialFileRef.current = null
      return
    }

    if (!skillFolderName || path === selectedFilePath) return

    // Cancel any in-flight fetch
    fetchCtrlRef.current?.abort()
    const ctrl = new AbortController()
    fetchCtrlRef.current = ctrl

    setSelectedFilePath(path)
    setFileLoading(true)

    try {
      const res = await fetch(
        `/api/skills/file?name=${encodeURIComponent(skillFolderName)}&path=${encodeURIComponent(path)}`,
        { signal: ctrl.signal },
      )
      if (ctrl.signal.aborted) return
      const data = await res.json()
      setFileContent(data.content ?? null)
    } catch {
      if (!ctrl.signal.aborted) setFileContent(null)
    } finally {
      if (!ctrl.signal.aborted) setFileLoading(false)
    }
  }, [skillFolderName, selectedFilePath])

  const handleBack = onBack ?? (() => router.push('/settings/skills'))

  const handleCreateChat = useCallback(async () => {
    if (!chatInput.trim() || !skill || isCreatingChat) return
    setIsCreatingChat(true)
    try {
      const newId = nanoid()
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newId }),
      })
      if (res.ok) {
        const initialMsg = `我在查看 "${skill.name}" 技能，${chatInput}`
        router.push(`/chat/user/${newId}?msg=${encodeURIComponent(initialMsg)}`)
      }
    } catch {
      // ignore
    } finally {
      setIsCreatingChat(false)
    }
  }, [chatInput, skill, isCreatingChat, router])

  // ── Not found (after loading completes) ──────────────────────
  if (!skillLoading && !skill) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <p>技能未找到</p>
        <Button variant="outline" size="sm" onClick={handleBack}>返回列表</Button>
      </div>
    )
  }

  // ── Render — layout is ALWAYS mounted so editorRef stays in DOM ─
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={handleBack} className="shrink-0">
              <ArrowLeftIcon className="size-4 mr-1" />
              返回
            </Button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 shrink-0">
                <WrenchIcon className="size-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-semibold truncate">{skill?.name ?? folderName}</h1>
                  {skill && <Badge variant="outline" className="text-xs shrink-0">{skill.source}</Badge>}
                </div>
                {skill && <p className="text-xs text-muted-foreground truncate">{skill.description}</p>}
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowChat(!showChat)} className="shrink-0">
            <SparklesIcon className="mr-1 size-4" />
            AI 编辑
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        <div className={cn("flex-1 min-w-0 overflow-hidden flex", showChat && "border-r")}>
          {/* File Tree */}
          <div className="w-64 border-r overflow-hidden flex flex-col shrink-0 bg-muted/20">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b">
              <FolderIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate">{skill?.folderName ?? folderName}</span>
            </div>
            <div className="flex-1 overflow-auto font-mono text-sm">
              {tree === null ? (
                <div className="text-xs text-muted-foreground p-3">加载中...</div>
              ) : tree.length > 0 ? (
                <SkillFileTree nodes={tree} selectedPath={selectedFilePath} onSelect={handleSelectFile} />
              ) : (
                <div className="text-xs text-muted-foreground p-3">没有文件</div>
              )}
            </div>
          </div>

          {/* File Preview */}
          <div className="flex-1 overflow-hidden p-3">
            <div className="relative flex flex-col overflow-hidden rounded-lg border h-full">
              {selectedFilePath && (
                <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCodeIcon className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-mono text-muted-foreground truncate" title={selectedFilePath}>
                      {selectedFilePath}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground/50 font-mono">.{getExt(selectedFilePath)}</span>
                </div>
              )}

              {/* Markdown or CodeMirror preview */}
              {isMarkdown(selectedFilePath ?? "") ? (
                <div className="flex-1 overflow-auto" style={{ visibility: fileLoading ? 'hidden' : 'visible' }}>
                  <div className="prose prose-sm dark:prose-invert max-w-none p-4">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-4">
                            <table className="border-collapse border w-full text-sm">{children}</table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead className="border-b bg-muted/50">{children}</thead>
                        ),
                        tbody: ({ children }) => (
                          <tbody>{children}</tbody>
                        ),
                        tr: ({ children }) => (
                          <tr className="border-b hover:bg-muted/30">{children}</tr>
                        ),
                        th: ({ children }) => (
                          <th className="border px-3 py-2 text-left font-medium">{children}</th>
                        ),
                        td: ({ children }) => (
                          <td className="border px-3 py-2">{children}</td>
                        ),
                        h1: ({ children }) => (
                          <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-xl font-bold mt-5 mb-2">{children}</h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-lg font-bold mt-4 mb-2">{children}</h3>
                        ),
                        p: ({ children }) => (
                          <p className="my-2 leading-relaxed">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc ml-6 my-2">{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal ml-6 my-2">{children}</ol>
                        ),
                        li: ({ children }) => (
                          <li className="my-1">{children}</li>
                        ),
                        code: ({ className, children }) => {
                          const isInline = !className;
                          if (isInline) {
                            return (
                              <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
                                {children}
                              </code>
                            );
                          }
                          return (
                            <code className={className}>{children}</code>
                          );
                        },
                        pre: ({ children }) => (
                          <pre className="rounded-md bg-muted p-4 overflow-x-auto my-4">
                            {children}
                          </pre>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-4 italic text-muted-foreground">
                            {children}
                          </blockquote>
                        ),
                        hr: () => (
                          <hr className="my-6 border-t" />
                        ),
                        a: ({ href, children }) => (
                          <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                        strong: ({ children }) => (
                          <strong className="font-bold">{children}</strong>
                        ),
                      }}
                    >
                      {fileContent}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div
                  ref={editorRef}
                  className="flex-1 overflow-auto"
                  style={{ visibility: fileLoading ? 'hidden' : 'visible' }}
                />
              )}

              {/* Loading overlay */}
              {fileLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40 text-sm">
                  加载中...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat Panel */}
        {showChat && (
          <div className="w-96 flex flex-col bg-background shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary" />
                <span className="text-sm font-medium">AI 对话</span>
              </div>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setShowChat(false)}>
                <XIcon className="size-4" />
              </Button>
            </div>
            <div className="flex-1 p-4 overflow-auto">
              <div className="space-y-4">
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p className="text-muted-foreground">
                    我正在查看 <span className="font-medium text-foreground">{skill?.name ?? folderName}</span> 技能。
                  </p>
                  {skill?.description && (
                    <p className="text-xs text-muted-foreground mt-1">{skill.description}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleCreateChat()}
                  placeholder="描述你想做什么..."
                  className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                  disabled={isCreatingChat}
                />
                <Button size="icon" onClick={handleCreateChat} disabled={!chatInput.trim() || isCreatingChat}>
                  <SendIcon className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">发送后将跳转到对话页面</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
