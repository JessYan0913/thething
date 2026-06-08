"use client";

import { Button } from "@/components/ui/button";
import {
  EyeIcon,
  CodeIcon,
  CopyIcon,
  CheckIcon,
  XIcon,
  Loader2Icon,
} from "lucide-react";
import { useState, useEffect } from "react";
import { CodeEditor } from "./code-editor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface FilePreviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  content: string;
  language?: string;
}

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TS",
  javascript: "JS",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  yaml: "YAML",
  markdown: "MD",
  bash: "Bash",
};

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".html": "html",
  ".css": "css",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".sh": "bash",
};

export function FilePreviewPanel({
  open,
  onOpenChange,
  filePath,
  content: initialContent,
  language,
}: FilePreviewPanelProps) {
  const [viewMode, setViewMode] = useState<"preview" | "code">(
    language === "markdown" ? "preview" : "code"
  );
  const [copied, setCopied] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedLang, setDetectedLang] = useState<string | undefined>(language);

  // 打开时加载完整文件内容
  useEffect(() => {
    if (!open || !filePath) return;

    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/fs?action=read&path=${encodeURIComponent(filePath)}`);
        if (!res.ok) {
          throw new Error(`Failed to load file: ${res.statusText}`);
        }
        const data = await res.json();
        setContent(data.content);

        // 根据文件扩展名设置语言
        if (!language && data.ext) {
          const lang = EXT_TO_LANG[data.ext];
          if (lang) {
            setDetectedLang(lang);
            setViewMode(lang === "markdown" ? "preview" : "code");
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [open, filePath, language]);

  if (!open) return null;

  const fileName = filePath.split("/").pop() ?? filePath;
  const langLabel = language ? LANGUAGE_LABELS[language] ?? language : detectedLang ? LANGUAGE_LABELS[detectedLang] ?? detectedLang : null;
  const displayLang = language ?? detectedLang;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full w-150 shrink-0 flex-col border-l bg-background">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {displayLang === "markdown" ? (
            <EyeIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <CodeIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm truncate">{fileName}</span>
          {langLabel && (
            <span className="text-xs text-muted-foreground">· {langLabel}</span>
          )}
          {isLoading && (
            <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* 预览/代码切换 - 仅 markdown 文件显示 */}
          {displayLang === "markdown" && (
            <div className="flex items-center rounded-md border mr-2">
              <Button
                variant={viewMode === "preview" ? "secondary" : "ghost"}
                size="icon"
                className="size-7 h-7"
                onClick={() => setViewMode("preview")}
              >
                <EyeIcon className="size-3.5" />
              </Button>
              <Button
                variant={viewMode === "code" ? "secondary" : "ghost"}
                size="icon"
                className="size-7 h-7"
                onClick={() => setViewMode("code")}
              >
                <CodeIcon className="size-3.5" />
              </Button>
            </div>
          )}
          {/* 复制按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 h-7"
            onClick={handleCopy}
          >
            {copied ? (
              <CheckIcon className="size-3.5 text-green-500" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
          </Button>
          {/* 关闭按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 h-7"
            onClick={() => onOpenChange(false)}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2Icon className="size-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-destructive">
            <p className="text-sm">{error}</p>
          </div>
        ) : viewMode === "preview" && displayLang === "markdown" ? (
          <div className="h-full overflow-auto">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <CodeEditor
            content={content}
            language={displayLang}
            readOnly={true}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Markdown 渲染器 - 使用 react-markdown
 */
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none p-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="border-collapse border w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b bg-muted/50">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody>{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="border-b hover:bg-muted/30">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="border px-3 py-2 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border px-3 py-2">{children}</td>
          ),
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mt-5 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-bold mt-4 mb-2">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="my-2 leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc ml-6 my-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal ml-6 my-2">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="my-1">{children}</li>
          ),
          code: ({ className, children }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
                  {children}
                </code>
              );
            }
            return (
              <code className={className}>{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="rounded-md bg-muted p-4 overflow-x-auto my-4">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-4 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="my-6 border-t" />
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-bold">{children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
