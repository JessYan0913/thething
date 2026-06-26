"use client"

import { useEffect, useRef, type RefObject } from "react"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { EditorState, Compartment } from "@codemirror/state"
import { defaultKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { css } from "@codemirror/lang-css"
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
import { createThemeCompartment, getCodeMirrorTheme } from "./codemirror-theme"

// ============================================================
// Language support lookup
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

// ============================================================
// Utilities
// ============================================================

export function getExt(filePath: string): string {
  const i = filePath.lastIndexOf(".")
  return i > 0 ? filePath.slice(i + 1).toLowerCase() : ""
}

export function isMarkdown(filePath: string): boolean {
  const ext = getExt(filePath)
  return ext === "md" || ext === "mdx"
}

// ============================================================
// Hook
// ============================================================

/**
 * 管理 CodeMirror 编辑器的完整生命周期。
 *
 * - 当切换到 Markdown 文件时自动销毁编辑器
 * - 内容更新时复用编辑器（dispatch change）
 * - 主题变化时动态切换亮/暗模式
 */
export function useCodeMirror(
  containerRef: RefObject<HTMLDivElement | null>,
  content: string | null,
  fileName: string | null,
  isDark: boolean,
) {
  const viewRef = useRef<EditorView | null>(null)
  const langCompartment = useRef(new Compartment())
  const themeCompartment = useRef(createThemeCompartment())

  // ── 创建/更新编辑器内容 ────────────────────────────────────
  useEffect(() => {
    // Markdown 文件：销毁 CodeMirror（由 ReactMarkdown 渲染）
    if (fileName && isMarkdown(fileName)) {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
      return
    }

    if (content === null || !containerRef.current) return

    const ext = getExt(fileName ?? "")
    const langExt = languageLoaders[ext]?.() ?? []

    if (viewRef.current) {
      // 编辑器已存在 → 更新内容 + 语言
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: content },
        effects: langCompartment.current.reconfigure(langExt),
      })
      return
    }

    // 首次创建编辑器
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
          "&": { fontSize: "13px" },
          ".cm-scroller": {
            fontFamily:
              '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace',
          },
          ".cm-content": { caretColor: "transparent" },
          ".cm-cursor": { borderLeftColor: "transparent" },
          ".cm-foldGutter .cm-gutterElement": { cursor: "pointer" },
          "&.cm-editor.cm-focused": { outline: "none" },
        }),
        themeCompartment.current.of(getCodeMirrorTheme(isDark)),
        langCompartment.current.of(langExt),
      ],
    })

    viewRef.current = new EditorView({ state, parent: containerRef.current })

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, fileName])

  // ── 主题切换 ──────────────────────────────────────────────
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(getCodeMirrorTheme(isDark)),
    })
  }, [isDark])
}
