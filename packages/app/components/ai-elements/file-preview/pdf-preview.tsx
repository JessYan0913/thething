"use client";

import { useState, useCallback } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ZoomInIcon,
  ZoomOutIcon,
  DownloadIcon,
  Loader2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// 动态导入 react-pdf 以避免 SSR 问题
const PDFDocument = async (props: any) => {
  const { Document, Page, pdfjs } = await import("react-pdf");
  await import("react-pdf/dist/Page/AnnotationLayer.css");
  await import("react-pdf/dist/Page/TextLayer.css");

  // 配置 pdf.js worker
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  return (
    <Document {...props}>
      <Page
        pageNumber={props.currentPage}
        scale={props.scale}
        renderTextLayer={true}
        renderAnnotationLayer={true}
      />
    </Document>
  );
};

interface PDFPreviewProps {
  /** PDF 文件 URL（blob URL 或 http URL） */
  src: string;
  /** 文件名 */
  filename?: string;
  /** 类名 */
  className?: string;
}

export function PDFPreview({ src, filename, className }: PDFPreviewProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(1);
    setLoading(false);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || "PDF 加载失败");
    setLoading(false);
  }, []);

  const goToPrevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const goToNextPage = () => setCurrentPage((p) => Math.min(p + 1, numPages));
  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.25));

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = filename || "document.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className || ""}`}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[5rem] text-center">
            {loading ? "加载中..." : `${currentPage} / ${numPages}`}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={goToNextPage}
            disabled={currentPage >= numPages}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleZoomOut}
            disabled={scale <= 0.5}
          >
            <ZoomOutIcon className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleZoomIn}
            disabled={scale >= 2}
          >
            <ZoomInIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleDownload}
          >
            <DownloadIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* PDF 内容 */}
      <div className="flex-1 overflow-auto flex items-start justify-center bg-muted/20 p-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <PDFDocument
          file={src}
          currentPage={currentPage}
          scale={scale}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
        />
      </div>
    </div>
  );
}
