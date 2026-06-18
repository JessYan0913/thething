"use client";

import { useState } from "react";
import { DownloadIcon, ZoomInIcon, ZoomOutIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImagePreviewProps {
  /** 图片 URL（blob URL 或 http URL） */
  src: string;
  /** 文件名 */
  filename?: string;
  /** 类名 */
  className?: string;
}

export function ImagePreview({ src, filename, className }: ImagePreviewProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState(false);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.25));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = filename || "image";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">图片加载失败</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className || ""}`}>
      {/* 工具栏 */}
      <div className="flex items-center justify-center gap-2 py-2 border-b">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleZoomOut}
          disabled={scale <= 0.25}
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
          disabled={scale >= 3}
        >
          <ZoomInIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleRotate}
        >
          <RotateCwIcon className="size-4" />
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

      {/* 图片容器 */}
      <div className="flex-1 overflow-auto flex items-center justify-center bg-muted/20 p-4">
        <img
          src={src}
          alt={filename || "图片预览"}
          className="max-w-full max-h-full object-contain transition-transform"
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
          }}
          onError={() => setError(true)}
        />
      </div>
    </div>
  );
}
