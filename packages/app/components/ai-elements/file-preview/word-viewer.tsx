"use client";

import { useState, useEffect } from "react";
import { Loader2Icon } from "lucide-react";

interface WordViewerProps {
  /** 文件的 ArrayBuffer */
  arrayBuffer: ArrayBuffer;
}

/**
 * WordViewer — .docx 视觉预览
 *
 * 使用 mammoth.convertToHtml() 将 docx 转为带样式 HTML，
 * DOMPurify 消毒后渲染到仿真纸张页面中。
 *
 * 保留标题、列表、加粗、表格等 Word 样式，
 * 页面居中展示，带纸张阴影和适当版心宽度。
 */
export function WordViewer({ arrayBuffer }: WordViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;

        const DOMPurify = (await import("dompurify")).default;
        const clean = DOMPurify.sanitize(result.value, {
          ADD_TAGS: ["style"],
          ADD_ATTR: ["style", "class"],
        });
        if (!cancelled) setHtml(clean);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "转换失败");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [arrayBuffer]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm p-4">
        {error}
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-muted/30">
      {/* 仿真纸张页面 */}
      <div
        className="
          mx-auto my-8
          w-full max-w-[860px]
          bg-white dark:bg-white
          shadow-[0_1px_4px_rgba(0,0,0,0.12),0_2px_12px_rgba(0,0,0,0.08)]
          rounded-sm
          px-10 py-12
          min-h-[600px]
        "
      >
        <div
          className="
            max-w-none

            /* 正文字体与大小 — 类似 Word 的阅读体验 */
            [font-family:Georgia,'Times_New_Roman',serif]
            text-[15px] leading-[1.7]
            text-foreground

            /* 标题样式 */
            [&_h1]:text-[26px] [&_h1]:font-bold [&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-foreground
            [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-foreground
            [&_h3]:text-[17px] [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-foreground
            [&_h4]:text-[15px] [&_h4]:font-semibold [&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:text-foreground

            /* 段落 */
            [&_p]:my-2 [&_p]:leading-[1.7]

            /* 列表 */
            [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2
            [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2
            [&_li]:my-1

            /* 表格 — 带边框 */
            [&_table]:w-full [&_table]:border-collapse [&_table]:my-4
            [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top
            [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:bg-muted/50 [&_th]:text-left

            /* 图片 */
            [&_img]:max-w-full [&_img]:h-auto [&_img]:my-4 [&_img]:rounded

            /* 引用 */
            [&_blockquote]:border-l-4 [&_blockquote]:border-muted-foreground/30
            [&_blockquote]:pl-4 [&_blockquote]:my-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground

            /* 代码 */
            [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_code]:font-mono
            [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:my-4 [&_pre]:overflow-x-auto

            /* 水平线 */
            [&_hr]:my-6 [&_hr]:border-t [&_hr]:border-border

            /* 链接 */
            [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/30 [&_a]:hover:decoration-primary

            /* 粗体/斜体保持原样 */
            [&_strong]:font-bold
            [&_em]:italic
          "
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
