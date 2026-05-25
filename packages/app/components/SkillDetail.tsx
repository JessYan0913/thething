import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  WrenchIcon, FolderIcon, LayersIcon,
  ArrowLeftIcon, PanelLeftOpenIcon, PanelRightOpenIcon,
  TagIcon, TargetIcon, InfoIcon, SparklesIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SkillFileTree, type SkillFileNode } from "@/components/SkillFileTree"
import { cn } from "@/lib/utils"
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
import { oneDark } from "@codemirror/theme-one-dark"
import {
  indentOnInput,
  foldGutter,
  indentUnit,
} from "@codemirror/language"
import { searchKeymap, closeSearchPanel } from "@codemirror/search"
import {
  closeBrackets,
  autocompletion,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete"
import { lintKeymap } from "@codemirror/lint"

const effortLabels: Record<string, string> = {
  low: "轻量",
  medium: "中等",
  high: "高开销",
}

const effortColors: Record<string, string> = {
  low: "bg-green-500/15 text-green-700 dark:text-green-400",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
}

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
  skill: SkillView
  onBack: () => void
}

export default function SkillDetail({ skill, onBack }: SkillDetailProps) {
  const router = useRouter()
  const [tree, setTree] = useState<SkillFileNode[] | null>(null)
  const [treeLoading, setTreeLoading] = useState(true)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [showTree, setShowTree] = useState(true)
  const [showPreview, setShowPreview] = useState(true)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langCompartment = useRef(new Compartment())

  useEffect(() => {
    setTreeLoading(true)
    fetch(`/api/skills/detail?name=${encodeURIComponent(skill.folderName)}`)
      .then((res) => res.json())
      .then((data) => {
        setTree(data.tree ?? [])
        if (data.skillMdPath) {
          setSelectedFilePath(data.skillMdPath)
        } else if (data.tree?.length > 0) {
          const first = findFirstFile(data.tree)
          if (first) setSelectedFilePath(first.path)
        }
      })
      .catch(() => setTree([]))
      .finally(() => setTreeLoading(false))
  }, [skill.folderName])

  useEffect(() => {
    if (!selectedFilePath) return
    setFileLoading(true)
    fetch(`/api/skills/file?name=${encodeURIComponent(skill.folderName)}&path=${encodeURIComponent(selectedFilePath)}`)
      .then((res) => res.json())
      .then((data) => setFileContent(data.content ?? null))
      .catch(() => setFileContent(null))
      .finally(() => setFileLoading(false))
  }, [selectedFilePath, skill.folderName])

  // Create editor once, update doc/language via dispatch
  useEffect(() => {
    if (!editorRef.current) return

    const detected = getExt(selectedFilePath ?? "")
    const loadLang = languageLoaders[detected]
    const langExtension = loadLang ? loadLang() : []

    if (viewRef.current) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: fileContent ?? "" },
        effects: langCompartment.current.reconfigure(langExtension),
      })
      return
    }

    const state = EditorState.create({
      doc: fileContent ?? "",
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
            返回
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <WrenchIcon className="size-5 shrink-0" />
            <h1 className="text-lg font-semibold truncate">{skill.name}</h1>
            {skill.source && (
              <Badge variant="outline" className="text-xs shrink-0">{skill.source}</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            onClick={() => router.push(`/skill-workbench/${encodeURIComponent(skill.folderName)}`)}
          >
            <SparklesIcon className="mr-1 size-4" />
            AI 编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTree(!showTree)}
            className={cn(showTree && "bg-accent")}
          >
            <PanelLeftOpenIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className={cn(showPreview && "bg-accent")}
          >
            <PanelRightOpenIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Skill Info Bar */}
      <div className="flex items-center gap-3 px-6 py-2 border-b bg-muted/20 text-xs text-muted-foreground">
        <Badge className={`text-xs border-0 ${effortColors[skill.effort] ?? effortColors.medium}`}>
          {effortLabels[skill.effort] ?? skill.effort}
        </Badge>
        {skill.model && (
          <Badge variant="outline" className="text-xs font-mono">
            <TagIcon className="size-3 mr-0.5" />
            {skill.model}
          </Badge>
        )}
        {skill.allowedTools.length > 0 && (
          <span className="flex items-center gap-1">
            <LayersIcon className="size-3" />
            {skill.allowedTools.length} 个工具
          </span>
        )}
        {skill.whenToUse && (
          <span className="flex items-center gap-1 truncate max-w-96" title={skill.whenToUse}>
            <TargetIcon className="size-3 shrink-0" />
            <span className="truncate">{skill.whenToUse}</span>
          </span>
        )}
      </div>

      {/* Split view: Tree + Preview */}
      <div className="flex-1 flex overflow-hidden">
        {showTree && (
          <div className="w-72 border-r overflow-hidden flex flex-col shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/20">
              <FolderIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate" title={skill.folderName}>
                {skill.folderName}
              </span>
            </div>
            <div className="flex-1 overflow-auto font-mono text-sm">
              {treeLoading ? (
                <div className="text-xs text-muted-foreground p-3">加载中...</div>
              ) : tree && tree.length > 0 ? (
                <SkillFileTree
                  nodes={tree}
                  selectedPath={selectedFilePath}
                  onSelect={setSelectedFilePath}
                />
              ) : (
                <div className="text-xs text-muted-foreground p-3">没有文件</div>
              )}
            </div>
          </div>
        )}

        {showPreview && (
          <div className="flex-1 overflow-hidden p-4">
            {fileLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
                加载中...
              </div>
            ) : fileContent ? (
              <div className="flex flex-col overflow-hidden rounded-lg border h-full">
                {selectedFilePath && (
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground">文件预览</span>
                      <span className="text-xs font-mono text-muted-foreground/70 truncate" title={selectedFilePath}>
                        {selectedFilePath.split("/").pop()}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground/50 font-mono">.{getExt(selectedFilePath)}</span>
                  </div>
                )}
                <div ref={editorRef} className="overflow-auto flex-1" />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
                选择一个文件以预览内容
              </div>
            )}
          </div>
        )}

        {!showTree && !showPreview && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/40 text-sm">
            <div className="text-center space-y-2">
              <InfoIcon className="size-8 mx-auto opacity-30" />
              <p>使用顶栏按钮切换面板显示</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
