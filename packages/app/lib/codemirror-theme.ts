import { useEffect, useState } from "react"
import { Compartment, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
import { oneDark } from "@codemirror/theme-one-dark"

/**
 * 检测当前是否为暗色模式
 */
function isDark(): boolean {
  if (typeof document === "undefined") return false
  return document.documentElement.classList.contains("dark")
}

/**
 * 监听系统/应用主题变化的 hook
 */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(isDark)

  useEffect(() => {
    setDark(isDark())

    const observer = new MutationObserver(() => {
      setDark(isDark())
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [])

  return dark
}

/**
 * 亮色主题语法高亮 — 基于 GitHub Light 风格的配色
 */
const lightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#cf222e" },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: "#24292f" },
  { tag: [t.function(t.variableName), t.labelName], color: "#8250df" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#0550ae" },
  { tag: [t.definition(t.name), t.separator], color: "#24292f" },
  { tag: [t.brace], color: "#24292f" },
  { tag: [t.annotation], color: "#953800" },
  { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: "#0550ae" },
  { tag: [t.typeName, t.className], color: "#953800" },
  { tag: [t.operator, t.operatorKeyword], color: "#cf222e" },
  { tag: [t.tagName], color: "#116329" },
  { tag: [t.squareBracket], color: "#24292f" },
  { tag: [t.angleBracket], color: "#24292f" },
  { tag: [t.attributeName], color: "#0550ae" },
  { tag: [t.regexp], color: "#0a3069" },
  { tag: [t.quote], color: "#24292f" },
  { tag: [t.string], color: "#0a3069" },
  { tag: t.link, color: "#0550ae", textDecoration: "underline" },
  { tag: [t.url, t.escape, t.special(t.string)], color: "#0550ae" },
  { tag: [t.meta], color: "#6e7781" },
  { tag: [t.comment], color: "#6e7781", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.heading, fontWeight: "bold", color: "#0550ae" },
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "bold", color: "#0550ae" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#0550ae" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "#0a3069" },
  { tag: t.contentSeparator, color: "#cf222e" },
  { tag: t.invalid, color: "#cb2431" },
])

/**
 * 亮色主题样式
 */
const lightTheme = [
  EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "#ffffff",
      color: "#24292f",
    },
    ".cm-gutters": {
      backgroundColor: "#f6f8fa",
      color: "#6e7781",
      borderRight: "1px solid #d0d7de",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#eaeef2",
    },
    ".cm-activeLine": {
      backgroundColor: "#f6f8fa",
    },
    ".cm-selectionBackground": {
      backgroundColor: "#add6ff !important",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "#add6ff !important",
    },
    ".cm-cursor": {
      borderLeftColor: "#24292f",
    },
    ".cm-matchingBracket": {
      backgroundColor: "#ddf4ff",
      outline: "1px solid #0969da",
    },
  }),
  syntaxHighlighting(lightHighlightStyle),
]

/**
 * 暗色主题 — 使用 oneDark 保持与之前一致的暗色效果
 */
const darkTheme = oneDark

/**
 * 让编辑器撑满容器的高度扩展（亮/暗主题共用）
 */
const fillHeight = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
})

/**
 * 创建主题 Compartment，用于动态切换 CodeMirror 亮/暗主题
 */
export function createThemeCompartment(): Compartment {
  return new Compartment()
}

/**
 * 根据当前暗色模式状态返回对应的 CodeMirror 主题扩展
 */
export function getCodeMirrorTheme(isDarkMode: boolean): Extension {
  return isDarkMode ? [darkTheme, fillHeight] : lightTheme
}
