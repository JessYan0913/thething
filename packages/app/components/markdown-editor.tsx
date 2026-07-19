"use client"

import { useEffect, useRef } from "react"
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view"
import { EditorState, Compartment } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { bracketMatching, indentOnInput, foldGutter } from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { searchKeymap } from "@codemirror/search"
import { markdown } from "@codemirror/lang-markdown"
import { useDarkMode, createThemeCompartment, getCodeMirrorTheme } from "@/lib/codemirror-theme"

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  className?: string
}

export default function MarkdownEditor({
  value,
  onChange,
  onSave,
  className,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isDark = useDarkMode()
  const themeCompartment = useRef(createThemeCompartment())
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return
    initializedRef.current = true

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        foldGutter(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        history(),
        markdown(),
        EditorView.lineWrapping,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          {
            key: "Mod-s",
            run: () => {
              onSave?.()
              return true
            },
            preventDefault: true,
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          "&": { fontSize: "13px" },
          ".cm-scroller": {
            fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace',
          },
          "&.cm-editor.cm-focused": { outline: "none" },
        }),
        themeCompartment.current.of(getCodeMirrorTheme(isDark)),
      ],
    })

    viewRef.current = new EditorView({ state, parent: containerRef.current })

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
      initializedRef.current = false
    }
    // Only mount once with initial value — updates go through onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Theme switching
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(getCodeMirrorTheme(isDark)),
    })
  }, [isDark])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ minHeight: 0 }}
    />
  )
}
