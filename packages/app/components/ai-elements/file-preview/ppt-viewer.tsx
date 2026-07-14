"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PptViewerProps {
  /** 文件的 ArrayBuffer */
  arrayBuffer: ArrayBuffer;
}

/**
 * PptViewer — .pptx 视觉预览
 *
 * 使用 pptx-preview 在浏览器端渲染幻灯片，
 * 支持翻页导航（上一页/下一页），宽高按 16:9 自适应。
 */
export function PptViewer({ arrayBuffer }: PptViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const { init } = await import("pptx-preview");
        if (cancelled || !containerRef.current) return;

        const instance = init(containerRef.current, {
          width: 960,
          height: 540,
          mode: "slide",
        });
        instanceRef.current = instance;

        await instance.preview(arrayBuffer);
        if (cancelled) return;

        setSlideCount(instance.slideCount || 0);
        setCurrentSlide(instance.currentIndex || 0);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "预览失败");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [arrayBuffer]);

  const goPrev = useCallback(() => {
    instanceRef.current?.renderPreSlide();
    setCurrentSlide((s) => Math.max(0, s - 1));
  }, []);

  const goNext = useCallback(() => {
    instanceRef.current?.renderNextSlide();
    setCurrentSlide((s) => Math.min(slideCount - 1, s + 1));
  }, [slideCount]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm p-4">
        {error}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* 幻灯片导航 */}
          <div className="flex items-center justify-center gap-3 py-2 border-b shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={goPrev}
              disabled={currentSlide <= 0}
            >
              上一页
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[4rem] text-center">
              {currentSlide + 1} / {slideCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={goNext}
              disabled={currentSlide >= slideCount - 1}
            >
              下一页
            </Button>
          </div>
          {/* 幻灯片内容 */}
          <div
            ref={containerRef}
            className="flex-1 overflow-auto flex items-start justify-center bg-muted/20 p-4"
          />
        </>
      )}
    </div>
  );
}
