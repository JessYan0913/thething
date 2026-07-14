"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2Icon } from "lucide-react";

interface ExcelViewerProps {
  /** 文件的 ArrayBuffer（.xlsx 或经过 SheetJS 转码的 .xls） */
  arrayBuffer: ArrayBuffer;
}

/**
 * ExcelViewer — .xlsx / .xls 视觉预览
 *
 * 使用 @js-preview/excel 在浏览器端渲染 Excel 表格。
 * 库内部基于 x-data-spreadsheet 实现，支持样式、合并单元格等。
 *
 * 注意：对于旧版 .xls，需要先用 SheetJS 转为 xlsx ArrayBuffer。
 */
export function ExcelViewer({ arrayBuffer }: ExcelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const jsPreviewExcel = (await import("@js-preview/excel")).default;
        if (cancelled || !containerRef.current) return;

        const instance = jsPreviewExcel.init(containerRef.current, {
          minColLength: 5,
          minRowLength: 5,
          showContextmenu: false,
        });
        instanceRef.current = instance;

        await instance.preview(arrayBuffer);
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "预览失败");
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [arrayBuffer]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm p-4">
        {error}
      </div>
    );
  }

  return (
    <div className="h-full relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <div ref={containerRef} className="h-full overflow-auto" />
    </div>
  );
}
