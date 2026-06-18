"use client";

import { useState, useEffect } from "react";
import { ExternalLinkIcon, Loader2Icon, CodeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HTMLPreviewProps {
  /** HTML 文件 URL（blob URL、http URL 或本地文件路径） */
  src: string;
  /** 文件名 */
  filename?: string;
  /** 类名 */
  className?: string;
}

/**
 * 检查是否为 HTTP/HTTPS URL
 */
function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * 检查是否为 blob URL
 */
function isBlobUrl(url: string): boolean {
  return url.startsWith("blob:");
}

export function HTMLPreview({ src, filename, className }: HTMLPreviewProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");

  useEffect(() => {
    const loadHTML = async () => {
      try {
        setLoading(true);
        setError(null);

        let text: string;

        if (isHttpUrl(src) || isBlobUrl(src)) {
          // HTTP URL 或 blob URL，直接 fetch
          const response = await fetch(src);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          text = await response.text();
        } else {
          // 本地文件路径，通过 /api/fs 读取
          const response = await fetch(`/api/fs?action=read&path=${encodeURIComponent(src)}`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const data = await response.json();
          text = data.content;
        }

        setHtmlContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    };

    loadHTML();
  }, [src]);

  const handleOpenInNewTab = () => {
    const blob = new Blob([htmlContent || ""], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin mb-2" />
        <p className="text-sm">正在加载 HTML...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          {/* 预览/源码切换 */}
          <div className="flex items-center rounded-md border">
            <Button
              variant={viewMode === "preview" ? "secondary" : "ghost"}
              size="icon"
              className="size-7"
              onClick={() => setViewMode("preview")}
            >
              <ExternalLinkIcon className="size-3.5" />
            </Button>
            <Button
              variant={viewMode === "source" ? "secondary" : "ghost"}
              size="icon"
              className="size-7"
              onClick={() => setViewMode("source")}
            >
              <CodeIcon className="size-3.5" />
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">HTML</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleOpenInNewTab}
          title="在新标签页打开"
        >
          <ExternalLinkIcon className="size-4" />
        </Button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "preview" ? (
          <iframe
            srcDoc={htmlContent || ""}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
            title={filename || "HTML 预览"}
          />
        ) : (
          <div className="h-full overflow-auto p-4">
            <pre className="text-sm font-mono whitespace-pre-wrap break-words">
              {htmlContent}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
