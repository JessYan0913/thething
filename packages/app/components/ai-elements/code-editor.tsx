"use client";

import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";

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

export function CodeEditor({
  content,
  language = "text",
  readOnly = true,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 获取语言扩展
    const langFactory = LANGUAGE_EXTENSIONS[language];
    const extensions = langFactory ? [langFactory()] : [];

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

        // 主题
        oneDark,

        // 语言
        ...extensions,

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
  }, [content, language, readOnly]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: "100%" }}
    />
  );
}
