"use client";

import { useEffect, useRef, useMemo } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, Decoration } from "@codemirror/view";
import { EditorState, StateField, RangeSetBuilder } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "next-themes";

// 语言导入
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";

interface CodeEditorProps {
  content: string;
  language?: string;
  readOnly?: boolean;
  className?: string;
  /** 启用 diff 高亮模式 */
  diffMode?: boolean;
}

const LANGUAGE_EXTENSIONS: Record<string, () => any> = {
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  python: () => python(),
  markdown: () => markdown(),
  css: () => css(),
  yaml: () => yaml(),
};

// ============================================================
// Diff 高亮扩展 - 使用 StateField 实现
// ============================================================

const addedLineMark = Decoration.line({
  attributes: { class: "cm-diff-added" },
});

const removedLineMark = Decoration.line({
  attributes: { class: "cm-diff-removed" },
});

const hunkHeaderMark = Decoration.line({
  attributes: { class: "cm-diff-hunk" },
});

const diffHighlightField = StateField.define({
  create(state) {
    return buildDiffDecorations(state.doc);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildDiffDecorations(tr.state.doc);
    }
    return decorations;
  },
  provide(f) {
    return EditorView.decorations.from(f);
  },
});

function buildDiffDecorations(doc: { line(n: number): { from: number; to: number; text: string }; lines: number }) {
  const builder = new RangeSetBuilder<Decoration>();

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    let decoration: Decoration | null = null;

    if (line.text.startsWith("+") && !line.text.startsWith("+++")) {
      decoration = addedLineMark;
    } else if (line.text.startsWith("-") && !line.text.startsWith("---")) {
      decoration = removedLineMark;
    } else if (line.text.startsWith("@@")) {
      decoration = hunkHeaderMark;
    }

    if (decoration) {
      // Line decorations 使用 point range (from === to)
      builder.add(line.from, line.from, decoration);
    }
  }

  return builder.finish();
}

// Diff 高亮主题（深色）
const diffDarkTheme = EditorView.theme({
  ".cm-diff-added": { backgroundColor: "rgba(34, 197, 94, 0.15)" },
  ".cm-diff-removed": { backgroundColor: "rgba(239, 68, 68, 0.15)" },
  ".cm-diff-hunk": { backgroundColor: "rgba(99, 102, 241, 0.15)" },
});

// Diff 高亮主题（浅色）
const diffLightTheme = EditorView.theme({
  ".cm-diff-added": { backgroundColor: "rgba(34, 197, 94, 0.2)" },
  ".cm-diff-removed": { backgroundColor: "rgba(239, 68, 68, 0.2)" },
  ".cm-diff-hunk": { backgroundColor: "rgba(99, 102, 241, 0.2)" },
});

// 浅色主题自定义样式
const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#1a1a1a",
  },
  ".cm-content": {
    caretColor: "#1a1a1a",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#1a1a1a",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#d4d4d4",
  },
  ".cm-panels": {
    backgroundColor: "#f5f5f5",
    color: "#1a1a1a",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid #e5e5e5",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid #e5e5e5",
  },
  ".cm-searchMatch": {
    backgroundColor: "#ffd700",
    outline: "1px solid #ffd700",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#ff8c00",
  },
  ".cm-activeLine": {
    backgroundColor: "#f5f5f5",
  },
  ".cm-selectionMatch": {
    backgroundColor: "#e0e0e0",
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "#d4d4d4",
  },
  ".cm-gutters": {
    backgroundColor: "#f8f8f8",
    color: "#999",
    border: "none",
    borderRight: "1px solid #e5e5e5",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#f0f0f0",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "#e5e5e5",
    border: "none",
    color: "#666",
  },
}, { dark: false });

export function CodeEditor({
  content,
  language = "text",
  readOnly = true,
  className,
  diffMode = false,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // 获取语言扩展
  const langFactory = language === "diff" ? undefined : LANGUAGE_EXTENSIONS[language];
  const langExtensions = useMemo(() => langFactory ? [langFactory()] : [], [langFactory]);

  useEffect(() => {
    if (!containerRef.current) return;

    // 根据主题选择主题扩展
    const themeExtension = isDark ? oneDark : lightTheme;

    // Diff 模式扩展
    const diffExtensions = diffMode ? [
      diffHighlightField,
      isDark ? diffDarkTheme : diffLightTheme,
    ] : [];

    // 创建编辑器状态
    const state = EditorState.create({
      doc: content,
      extensions: [
        // 基础功能
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),

        // 键绑定
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...lintKeymap,
        ]),

        // 语法高亮
        syntaxHighlighting(defaultHighlightStyle),

        // 主题（根据系统主题切换）
        themeExtension,

        // 语言
        ...langExtensions,

        // Diff 高亮
        ...diffExtensions,

        // 只读模式
        readOnly ? EditorState.readOnly.of(true) : [],
        readOnly ? EditorView.editable.of(false) : [],

        // 自动换行
        EditorView.lineWrapping,
      ],
    });

    // 创建编辑器视图
    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [content, langExtensions, readOnly, isDark, diffMode]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: "100%" }}
    />
  );
}
