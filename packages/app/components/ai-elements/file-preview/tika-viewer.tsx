"use client";

import { useState, useEffect } from "react";
import { Loader2Icon, AlertCircleIcon } from "lucide-react";

interface TikaViewerProps {
  /** 文件 URL（本地路径、http URL、或 blob URL） */
  src: string;
  /** 文件名 */
  filename: string;
}

/**
 * TikaViewer — .doc / .ppt（旧版 Office 格式）视觉预览
 *
 * 通过服务端 Apache Tika 代理将旧版二进制格式转为 HTML。
 * 代理路径: /api/file/convert-tika
 *
 * - 本地文件路径 → GET /api/file/convert-tika?path=...
 * - blob/data URL → POST /api/file/convert-tika (FormData)
 */
export function TikaViewer({ src, filename }: TikaViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        let htmlText: string;

        if (
          src.startsWith("http://") ||
          src.startsWith("https://") ||
          src.startsWith("blob:") ||
          src.startsWith("data:")
        ) {
          // blob / data / http URL → 先下载再 POST 到 Tika
          const res = await fetch(src);
          const blob = await res.blob();
          const form = new FormData();
          form.append("file", blob, filename);

          const tikaRes = await fetch("/api/file/convert-tika", {
            method: "POST",
            body: form,
          });
          if (!tikaRes.ok) {
            const text = await tikaRes.text().catch(() => "");
            throw new Error(text || `Tika 转换失败: HTTP ${tikaRes.status}`);
          }
          htmlText = await tikaRes.text();
        } else {
          // 本地文件路径 → 服务端直接读取
          const tikaRes = await fetch(
            `/api/file/convert-tika?path=${encodeURIComponent(src)}`
          );
          if (!tikaRes.ok) {
            const text = await tikaRes.text().catch(() => "");
            throw new Error(text || `Tika 转换失败: HTTP ${tikaRes.status}`);
          }
          htmlText = await tikaRes.text();
        }

        if (!cancelled) setHtml(htmlText);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "转换失败";
          // Tika 未配置时给出更友好的提示
          if (msg.includes("TIKA_BACKEND_URL 未配置")) {
            setError("服务端 Tika 未配置，无法预览此格式");
          } else {
            setError(msg);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [src, filename]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive gap-2 p-4">
        <AlertCircleIcon className="size-8" />
        <p className="text-sm text-center">{error}</p>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto p-6 prose prose-sm dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: html || "" }}
    />
  );
}
