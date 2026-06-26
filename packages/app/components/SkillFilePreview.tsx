"use client"

import { useRef } from "react"
import { FileCodeIcon } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useDarkMode } from "@/lib/codemirror-theme"
import { useCodeMirror, getExt, isMarkdown } from "@/lib/use-code-mirror"

// ============================================================
// Markdown 组件样式
// ============================================================

const mdComponents = {
  table: ({ children }: { children: React.ReactNode }) => (
    <div className="overflow-x-auto my-4">
      <table className="border-collapse border w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children: React.ReactNode }) => (
    <thead className="border-b bg-muted/50">{children}</thead>
  ),
  tbody: ({ children }: { children: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children: React.ReactNode }) => (
    <tr className="border-b hover:bg-muted/30">{children}</tr>
  ),
  th: ({ children }: { children: React.ReactNode }) => (
    <th className="border px-3 py-2 text-left font-medium">{children}</th>
  ),
  td: ({ children }: { children: React.ReactNode }) => (
    <td className="border px-3 py-2">{children}</td>
  ),
  h1: ({ children }: { children: React.ReactNode }) => (
    <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-xl font-bold mt-5 mb-2">{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-lg font-bold mt-4 mb-2">{children}</h3>
  ),
  p: ({ children }: { children: React.ReactNode }) => (
    <p className="my-2 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul className="list-disc ml-6 my-2">{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol className="list-decimal ml-6 my-2">{children}</ol>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li className="my-1">{children}</li>
  ),
  code: ({
    className,
    children,
  }: {
    className?: string
    children: React.ReactNode
  }) => {
    if (!className) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
          {children}
        </code>
      )
    }
    return <code className={className}>{children}</code>
  },
  pre: ({ children }: { children: React.ReactNode }) => (
    <pre className="rounded-md bg-muted p-4 overflow-x-auto my-4">
      {children}
    </pre>
  ),
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-t" />,
  a: ({ href, children }: { href?: string; children: React.ReactNode }) => (
    <a
      href={href}
      className="text-primary hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
}

// ============================================================
// Component
// ============================================================

interface SkillFilePreviewProps {
  filePath: string | null
  fileContent: string | null
  isLoading: boolean
}

/**
 * 技能文件预览面板。
 *
 * - Markdown 文件 → ReactMarkdown 渲染
 * - 其他文件 → CodeMirror 语法高亮
 * - 加载中时显示覆盖层（保留之前内容可见）
 */
export function SkillFilePreview({
  filePath,
  fileContent,
  isLoading,
}: SkillFilePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isDark = useDarkMode()
  const showMarkdown = filePath ? isMarkdown(filePath) : false

  // CodeMirror 生命周期管理（markdown 文件会自动跳过）
  useCodeMirror(containerRef, showMarkdown ? null : fileContent, filePath, isDark)

  return (
    <div className="relative flex flex-col overflow-hidden rounded-lg border h-full">
      {/* 文件路径头部 */}
      {filePath && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileCodeIcon className="size-3.5 text-muted-foreground" />
            <span
              className="text-xs font-mono text-muted-foreground truncate"
              title={filePath}
            >
              {filePath}
            </span>
          </div>
          <span className="text-xs text-muted-foreground/50 font-mono">
            .{getExt(filePath)}
          </span>
        </div>
      )}

      {/* Markdown 渲染 */}
      {showMarkdown ? (
        <div
          className="flex-1 overflow-auto"
          style={{ visibility: isLoading ? "hidden" : "visible" }}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as any}>
              {fileContent ?? ""}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        /* CodeMirror 容器 */
        <div
          ref={containerRef}
          className="flex-1 overflow-auto"
          style={{ visibility: isLoading ? "hidden" : "visible" }}
        />
      )}

      {/* 加载覆盖层 */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40 text-sm">
          加载中...
        </div>
      )}
    </div>
  )
}
