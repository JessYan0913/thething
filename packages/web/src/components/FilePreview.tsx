import { useEffect, useRef, useState } from "react"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { defaultKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { css } from "@codemirror/lang-css"
import { oneDark } from "@codemirror/theme-one-dark"
import { indentOnInput, foldGutter, indentUnit } from "@codemirror/language"
import { searchKeymap, closeSearchPanel } from "@codemirror/search"
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { lintKeymap } from "@codemirror/lint"
import { cn } from "@/lib/utils"

interface FilePreviewProps {
  /** 文件路径 */
  filePath: string | null
  /** 可选的文件内容（如果传了则直接使用，不请求 API） */
  initialContent?: string
  /** 文件扩展名（可选，用于优化语言检测） */
  ext?: string
  /** 显示文件名头 */
  showHeader?: boolean
  /** 类名 */
  className?: string
  /** 最小高度 */
  minHeight?: number
}

const languageLoaders: Record<string, (() => import("@codemirror/language").LanguageSupport) | undefined> = {
  md: () => markdown(),
  mdx: () => markdown(),
  markdown: () => markdown(),
  json: () => json(),
  yaml: () => yaml(),
  yml: () => yaml(),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  mjs: () => javascript({ typescript: true }),
  cjs: () => javascript(),
  py: () => python(),
  python: () => python(),
  css: () => css(),
}

function getLanguageExt(filePath: string, ext?: string): string {
  if (ext) return ext.replace(/^\./, '').toLowerCase()
  const parts = filePath.split('.')
  if (parts.length > 1) return parts[parts.length - 1].toLowerCase()
  return ''
}

/**
 * CodeMirror 文件预览组件
 *
 * 只读模式的文件内容浏览器，支持多种语言语法高亮。
 * 自动根据文件扩展名选择合适的语言解析器。
 */
export function FilePreview({
  filePath,
  initialContent,
  ext: extHint,
  showHeader = true,
  className,
  minHeight,
}: FilePreviewProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [content, setContent] = useState<string | null>(initialContent ?? null)
  const [fileName, setFileName] = useState("")
  const [isLoading, setIsLoading] = useState(!initialContent)
  const [error, setError] = useState<string | null>(null)
  const [langExt, setLangExt] = useState("")

  // 加载文件内容
  useEffect(() => {
    if (initialContent !== undefined) {
      setContent(initialContent)
      setIsLoading(false)
      return
    }
    if (!filePath) {
      setContent(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    setFileName(filePath.split('/').pop() ?? filePath)
    const detected = getLanguageExt(filePath, extHint)
    setLangExt(detected)

    fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        setContent(data.content)
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setIsLoading(false)
      })
  }, [filePath, extHint, initialContent])

  // 初始化/更新 CodeMirror 编辑器
  useEffect(() => {
    if (!editorRef.current || !content) return

    // 清理旧视图
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const detected = getLanguageExt(filePath ?? fileName, extHint)
    const loadLang = languageLoaders[detected]
    const langExtension = loadLang ? loadLang() : []

    const state = EditorState.create({
      doc: content,
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
          "&": {
            fontSize: "13px",
          },
          ".cm-scroller": {
            fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace',
          },
          ".cm-content": {
            caretColor: "transparent",
          },
          ".cm-cursor": {
            borderLeftColor: "transparent",
          },
          ".cm-foldGutter .cm-gutterElement": {
            cursor: "pointer",
          },
          "&.cm-editor.cm-focused": {
            outline: "none",
          },
        }),
        oneDark,
        langExtension,
      ],
    })

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [content, filePath, fileName, extHint, minHeight])

  if (!filePath && !initialContent) {
    return (
      <div className={cn("flex items-center justify-center py-12 text-muted-foreground/40 text-sm", className)}>
        选择一个文件以预览内容
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-12 text-muted-foreground/40 text-sm", className)}>
        加载中...
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn("flex items-center justify-center py-12 text-destructive/60 text-sm", className)}>
        加载失败: {error}
      </div>
    )
  }

  if (content === null) return null

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border", className)}>
      {showHeader && filePath && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted-foreground">文件预览</span>
            <span className="text-xs font-mono text-muted-foreground/70 truncate" title={filePath}>
              {filePath.split('/').pop()}
            </span>
          </div>
          <span className="text-xs text-muted-foreground/50 font-mono">.{langExt}</span>
        </div>
      )}
      <div ref={editorRef} className="overflow-auto" />
    </div>
  )
}
