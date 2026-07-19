# Plan: Wiki 编辑改用 CodeMirror

## Context

当前 wiki（记忆库）页面编辑时使用的是原生 `<Textarea>`——见 [WikiDetail.tsx:210-215](packages/app/components/WikiDetail.tsx#L210-L215)。它只给了等宽字体，没有语法高亮、行号、自动补全等任何编辑增强。

项目里 CodeMirror 6 已经完整安装（含 `@codemirror/lang-markdown`），但目前**所有 CodeMirror 用法都是只读**的（[CodeEditor](packages/app/components/ai-elements/code-editor.tsx) 和 [useCodeMirror](packages/app/lib/use-code-mirror.ts)）。其中 `useCodeMirror` 还专门对 `.md` 文件"销毁编辑器改用 ReactMarkdown"——见 [use-code-mirror.ts:84-90](packages/app/lib/use-code-mirror.ts#L84-L90)，无法直接复用做可编辑编辑器。

目标：把 wiki 编辑态从 `<Textarea>` 换成可编辑的 CodeMirror（markdown 语言 + 语法高亮 + 行号 + 亮/暗主题 + Ctrl+S 保存）。

## 方案

新建一个 `MarkdownEditor` 组件（可编辑、受控），在 `WikiDetail.tsx` 编辑态替换 `<Textarea>`。不复用既有只读组件——它们用 `readOnly` 并且 `CodeEditor` 在 `content` 变化时会销毁重建编辑器（[code-editor.tsx:254](packages/app/components/ai-elements/code-editor.tsx#L254)），按值受控会让每次按键都重建编辑器，不可用；`useCodeMirror` 又销毁 markdown。所以新建一个聚焦的组件最干净，符合 CLAUDE.md「surgical changes / 不过度抽象」。

### 1. 新建 `packages/app/components/markdown-editor.tsx`

参考 [code-editor.tsx](packages/app/components/ai-elements/code-editor.tsx) 的主题与扩展写法，复用 [codemirror-theme.ts](packages/app/lib/codemirror-theme.ts) 里的 `useDarkMode` + `getCodeMirrorTheme` 做亮/暗切换（避免引 `next-themes`，保持与 `useCodeMirror` 同一主题体系）。

要点：
- props: `{ value: string; onChange: (v: string) => void; onSave?: () => void; className?: string }`
- 用 compartment 管理主题，主题变化只 reconfigure 不重建
- **初始 doc 用 `value`，之后不再因 `value` 变化重建编辑器**——避免按键重建。用 `EditorView.updateListener` 把文档变化回传 `onChange`，并用 `useRef` 跟踪最后一次回传的值避免光标跳动循环
- 扩展：`markdown()` 语言、`lineNumbers`、`history()`、`foldGutter`、`bracketMatching`、`closeBrackets`、`highlightActiveLine`、`EditorView.lineWrapping`（markdown 长文需换行）、keymap（`defaultKeymap` + `historyKeymap` + `searchKeymap`）
- Ctrl+S：自定义 `keymap.of([{ key: "Mod-s", run: () => { onSave?.(); return true } }])`
- 复用 [codemirror-theme.ts](packages/app/lib/codemirror-theme.ts) 已有的 `lightTheme`/`oneDark`、行号样式

### 2. 改 `packages/app/components/WikiDetail.tsx`

把 [208-220 行](packages/app/components/WikiDetail.tsx#L208-L220) 编辑态的 `<Textarea>` 换成 `<MarkdownEditor>`：

```tsx
<MarkdownEditor
  value={editContent}
  onChange={setEditContent}
  onSave={handleSaveEdit}
  className="flex-1 min-h-0"
/>
```

保留下方"取消"按钮和提示；删掉 `Textarea` 的 import（若仅此处使用）。`Ctrl+S 保存` 提示文案现在才真正生效。

## 不做

- 不动 `MemorySettings.tsx` 新建对话框里的 `<Textarea>`（用户没要求，超出范围）
- 不改 `useCodeMirror` / `CodeEditor`（会牵动多个只读消费者）
- 不做工具栏/分屏预览（超出"用 CodeMirror"的范围）

## Verification

1. `cd packages/app && pnpm dev` 启动 dev server
2. 进入 设置 → 记忆库（wiki），点任一页面 → 编辑
3. 验证：
   - markdown 语法高亮正常（标题/列表/代码块/链接着色）
   - 行号显示、可输入、光标正常、可撤销/搜索
   - 亮/暗主题切换时代码区跟随切换
   - Ctrl+S 触发保存并退出编辑态
   - 取消按钮丢弃改动、保存按钮提交内容正确
4. 对比原有 ReactMarkdown 预览态内容一致