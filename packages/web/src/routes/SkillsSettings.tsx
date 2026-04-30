import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  WrenchIcon, RefreshCwIcon, FolderIcon, LayersIcon,
  ArrowLeftIcon, PanelLeftOpenIcon, PanelRightOpenIcon,
  TagIcon, TargetIcon, InfoIcon, PlusIcon, MoreVerticalIcon,
  Trash2Icon, SearchIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { UploadSkillDialog } from "@/components/SkillUploadDialog"
import { SkillFileTree, type SkillFileNode } from "@/components/SkillFileTree"
import { cn } from "@/lib/utils"
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
import { searchKeymap, closeSearchPanel } from "@codemirror/search"
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

interface SkillView {
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

// ============================================================
// Main Component
// ============================================================

export default function SkillsSettings() {
  const [skills, setSkills] = useState<SkillView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSkill, setSelectedSkill] = useState<SkillView | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillView | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const loadSkills = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/skills")
      if (res.ok) {
        const data = await res.json()
        setSkills(data.skills ?? [])
      }
    } catch {
      setSkills([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadSkills() }, [loadSkills])

  const filteredSkills = useMemo(() => {
    if (!searchQuery) return skills
    const q = searchQuery.toLowerCase()
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    )
  }, [skills, searchQuery])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const res = await fetch(
        `/api/skills?name=${encodeURIComponent(deleteTarget.folderName)}`,
        { method: "DELETE" },
      )
      if (res.ok) {
        setSkills((prev) => prev.filter((s) => s.folderName !== deleteTarget.folderName))
        setMessage({ type: "success", text: "Skill 已删除" })
      } else {
        const data = await res.json()
        throw new Error(data.error || "删除失败")
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "删除失败" })
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
      setTimeout(() => setMessage(null), 3000)
    }
  }, [deleteTarget])

  const handleUploadSuccess = useCallback(() => {
    setMessage({ type: "success", text: "Skill 上传成功" })
    loadSkills()
    setTimeout(() => setMessage(null), 3000)
  }, [loadSkills])

  if (selectedSkill) {
    return (
      <SkillDetail
        skill={selectedSkill}
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={loadSkills} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="sm" onClick={() => setIsUploadOpen(true)}>
          <PlusIcon className="mr-1 size-4" />
          上传 Skill
        </Button>
      </div>

      {/* Message toast */}
      {message && (
        <div className={`mx-6 mt-3 px-3 py-2 rounded-md text-sm ${
          message.type === "success"
            ? "bg-green-500/10 text-green-700 dark:text-green-400"
            : "bg-red-500/10 text-red-700 dark:text-red-400"
        }`}>
          {message.text}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <WrenchIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">
                {searchQuery ? "未找到匹配的技能" : "暂无技能"}
              </p>
              <p className="text-xs">
                {searchQuery
                  ? "尝试更换关键词搜索"
                  : "上传包含 SKILL.md 文件的文件夹来创建新技能"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredSkills.map((skill) => (
              <SkillCard
                key={skill.folderName}
                skill={skill}
                onClick={() => setSelectedSkill(skill)}
                onDelete={() => setDeleteTarget(skill)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <UploadSkillDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onSuccess={handleUploadSuccess}
      />

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !isDeleting && setDeleteTarget(null)}>
          <div
            className="bg-background rounded-lg border shadow-lg max-w-sm w-full mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">确认删除</h3>
              <p className="text-sm text-muted-foreground">
                确定要删除技能 "{deleteTarget.name}" 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "删除中..." : "确认删除"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// CodeMirror 语言加载器
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

// ============================================================
// SkillDetail — 技能详情视图（文件树 + CodeMirror 预览）
// ============================================================

interface SkillDetailProps {
  skill: SkillView
  onBack: () => void
}

function SkillDetail({ skill, onBack }: SkillDetailProps) {
  const [tree, setTree] = useState<SkillFileNode[] | null>(null)
  const [treeLoading, setTreeLoading] = useState(true)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [showTree, setShowTree] = useState(true)
  const [showPreview, setShowPreview] = useState(true)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // 加载文件树
  useEffect(() => {
    setTreeLoading(true)
    fetch(`/api/skills/detail?name=${encodeURIComponent(skill.folderName)}`)
      .then((res) => res.json())
      .then((data) => {
        setTree(data.tree ?? [])
        // 自动选中 SKILL.md 或第一个文件
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

  // 加载文件内容
  useEffect(() => {
    if (!selectedFilePath) return
    setFileLoading(true)
    fetch(`/api/skills/file?name=${encodeURIComponent(skill.folderName)}&path=${encodeURIComponent(selectedFilePath)}`)
      .then((res) => res.json())
      .then((data) => setFileContent(data.content ?? null))
      .catch(() => setFileContent(null))
      .finally(() => setFileLoading(false))
  }, [selectedFilePath, skill.folderName])

  // 渲染 CodeMirror
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

/**
 * 递归查找文件树中的第一个文件
 */
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
// SkillCard — 技能列表卡片
// ============================================================

function SkillCard({
  skill,
  onClick,
  onDelete,
}: {
  skill: SkillView
  onClick: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      className="rounded-lg border p-4 space-y-3 w-full hover:border-accent/50 hover:bg-accent/20 transition-colors relative"
    >
      <div className="flex items-start justify-between gap-4">
        <button
          onClick={onClick}
          className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer"
        >
          <WrenchIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{skill.name}</span>
              <Badge
                className={`text-xs border-0 ${effortColors[skill.effort] ?? effortColors.medium}`}
              >
                {effortLabels[skill.effort] ?? skill.effort}
              </Badge>
              {skill.model && (
                <Badge variant="outline" className="text-xs font-mono">
                  {skill.model}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {skill.description}
            </p>
            {skill.whenToUse && (
              <p className="text-xs text-muted-foreground/60 italic">
                适用场景：{skill.whenToUse}
              </p>
            )}
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
                  <Trash2Icon className="size-3.5" />
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <FolderIcon className="size-3" />
          <span className="truncate max-w-64" title={skill.sourcePath}>
            {skill.sourcePath}
          </span>
        </div>
        <span className="text-muted-foreground/40">|</span>
        <div className="flex items-center gap-1">
          <LayersIcon className="size-3" />
          <span>{skill.allowedTools.length} 个工具</span>
        </div>
        <span className="text-muted-foreground/40">|</span>
        <Badge variant="outline" className="text-xs">
          {skill.source}
        </Badge>
      </div>
    </div>
  )
}
