"use client";

import { useState, useEffect, useRef } from "react";
import {
  EyeIcon,
  CodeIcon,
  CopyIcon,
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { DocInputBar } from "./DocInputBar";
import type { DocItem } from "./DocPreviewLayout";

interface DocContentProps {
  doc: DocItem | null;
  onUpdateDoc: (id: string, content: string) => void;
}

const LANGUAGE_LABELS: Record<string, string> = {
  md: "MD",
  json: "JSON",
  txt: "TXT",
};

export function DocContent({ doc, onUpdateDoc }: DocContentProps) {
  const [viewMode, setViewMode] = useState<"preview" | "code">(
    doc?.type === "md" ? "preview" : "code"
  );
  const [copied, setCopied] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  // 当文档切换时，重置流式状态
  useEffect(() => {
    setStreamedContent("");
    setIsStreaming(false);
  }, [doc?.id]);

  // 自动滚动到底部
  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [streamedContent, isStreaming]);

  // 模拟流式输出
  const handleStreamGenerate = async () => {
    if (!doc || isStreaming) return;

    setIsStreaming(true);
    setStreamedContent("");
    setViewMode("preview");

    const fullContent = doc.content;
    const chunkSize = 20; // 每次输出的字符数

    for (let i = 0; i < fullContent.length; i += chunkSize) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      setStreamedContent(fullContent.slice(0, i + chunkSize));
    }

    setIsStreaming(false);
  };

  const handleCopy = async () => {
    if (!doc) return;
    await navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!doc) return;
    const blob = new Blob([doc.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.title}.${doc.type}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!doc) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FileTextIcon className="size-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">选择一个文档查看</p>
          <p className="text-sm mt-1">或创建一个新文档</p>
        </div>
      </div>
    );
  }

  const displayContent = streamedContent || doc.content;
  const langLabel = LANGUAGE_LABELS[doc.type] ?? doc.type.toUpperCase();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{doc.title}</span>
          <span className="text-xs text-muted-foreground">· {langLabel}</span>
          {isStreaming && (
            <span className="flex items-center gap-1 text-xs text-blue-500">
              <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
              生成中...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 预览/代码切换 - 仅 markdown */}
          {doc.type === "md" && (
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
          {/* 下载按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 h-7"
            onClick={handleDownload}
          >
            <DownloadIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 内容区域 */}
      <div ref={contentRef} className="flex-1 overflow-auto">
        {viewMode === "preview" && doc.type === "md" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none p-6">
            <MarkdownRenderer content={displayContent} />
          </div>
        ) : (
          <div className="p-4">
            <CodeBlock code={displayContent} language={(doc.type === "json" ? "json" : "text") as any} />
          </div>
        )}
      </div>

      {/* 底部输入栏 */}
      <DocInputBar
        isStreaming={isStreaming}
        onGenerate={handleStreamGenerate}
        onStop={() => setIsStreaming(false)}
      />
    </div>
  );
}

// 需要导入 FileTextIcon
/**
 * 简单的 Markdown 渲染器
 */
function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeContent = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // 代码块处理
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="rounded-md bg-muted p-4 overflow-x-auto">
            <code>{codeContent.trim()}</code>
          </pre>
        );
        codeContent = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + "\n";
      continue;
    }

    // 空行
    if (line.trim() === "") {
      elements.push(<br key={`br-${i}`} />);
      continue;
    }

    // 标题
    if (line.startsWith("# ")) {
      elements.push(<h1 key={`h1-${i}`} className="text-2xl font-bold mt-4 mb-2">{line.slice(2)}</h1>);
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h2 key={`h2-${i}`} className="text-xl font-bold mt-3 mb-2">{line.slice(3)}</h2>);
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(<h3 key={`h3-${i}`} className="text-lg font-bold mt-2 mb-1">{line.slice(4)}</h3>);
      continue;
    }

    // 表格
    if (line.startsWith("|")) {
      const tableLines: string[] = [line];
      // 收集后续表格行
      while (i + 1 < lines.length && lines[i + 1]?.startsWith("|")) {
        i++;
        tableLines.push(lines[i]!);
      }
      elements.push(
        <table key={`table-${i}`} className="border-collapse border my-4 w-full text-sm">
          <tbody>
            {tableLines.map((row, ri) => {
              // 跳过分隔行
              if (row.match(/^\|[\s-|]+\|$/)) return null;
              const cells = row.split("|").filter((c) => c.trim() !== "");
              return (
                <tr key={ri} className="border-b">
                  {cells.map((cell, ci) => (
                    <td key={ci} className="border px-3 py-2">
                      {renderInlineMarkdown(cell.trim())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      );
      continue;
    }

    // 列表
    if (line.match(/^[-*] /)) {
      elements.push(
        <li key={`li-${i}`} className="ml-4 list-disc">
          {renderInlineMarkdown(line.slice(2))}
        </li>
      );
      continue;
    }
    if (line.match(/^\d+\. /)) {
      const text = line.replace(/^\d+\. /, "");
      elements.push(
        <li key={`oli-${i}`} className="ml-4 list-decimal">
          {renderInlineMarkdown(text)}
        </li>
      );
      continue;
    }

    // 普通段落
    elements.push(
      <p key={`p-${i}`} className="my-1">
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  return <>{elements}</>;
}

/**
 * 渲染行内 Markdown
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((codePart, j) => {
      if (codePart.startsWith("`") && codePart.endsWith("`")) {
        return (
          <code key={`${i}-${j}`} className="rounded bg-muted px-1 py-0.5 text-sm font-mono">
            {codePart.slice(1, -1)}
          </code>
        );
      }
      return <span key={`${i}-${j}`}>{codePart}</span>;
    });
  });
}
