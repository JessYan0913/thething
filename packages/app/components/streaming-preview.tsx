'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { StreamingPreviewProps } from '@/types/mcp';

/**
 * StreamingPreview - 显示工具流式输入的预览
 *
 * 功能：
 * 1. 显示正在生成的输入内容
 * 2. 自动滚动到底部
 * 3. 脉冲动画背景
 * 4. 支持 JSON 和代码高亮
 */
export function StreamingPreview({ input, toolName, className }: StreamingPreviewProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [input]);

  // 格式化输入内容
  const formatInput = () => {
    // 如果有 code 字段，优先显示（Three.js 示例的模式）
    if ('code' in input && typeof input.code === 'string') {
      return input.code;
    }

    // 否则显示完整的 JSON
    return JSON.stringify(input, null, 2);
  };

  const content = formatInput();
  const hasContent = content.length > 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-muted/30',
        className
      )}
    >
      {/* 脉冲动画背景 */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 animate-pulse" />

      {/* 标题栏 */}
      <div className="relative flex items-center gap-2 border-b bg-background/50 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          {/* 加载动画 */}
          <div className="relative flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-blue-500" />
          </div>
          <span className="text-sm font-medium text-foreground">
            Generating input for {toolName}...
          </span>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="relative">
        {hasContent ? (
          <pre
            ref={preRef}
            className="max-h-64 overflow-auto p-4 text-xs font-mono text-foreground/80"
          >
            {content}
            {/* 光标效果 */}
            <span className="inline-block w-2 h-4 ml-1 bg-blue-500 animate-pulse" />
          </pre>
        ) : (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Waiting for input...
            </div>
          </div>
        )}
      </div>

      {/* 进度指示器 */}
      <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden bg-transparent">
        <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
      </div>
    </div>
  );
}
