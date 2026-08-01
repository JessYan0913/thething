"use client";

import { TerminalChrome } from "@/components/ai-elements/bash-streaming-card";

interface ToolReportCardProps {
  /** 终端标题栏显示的工具名(如 grep / wiki / cron) */
  label: string;
  content: string;
}

/**
 * 通用工具报告卡:点击工具行内联展开/收起,
 * 用于输出本质是"报告/列表/摘要"而非文件的工具(grep/glob/wiki/cron/skill 等),
 * 替代右侧文件预览面板(那属于文件类工具)。
 * 与 bash 终端卡同视觉(红绿灯标题栏 + 等宽正文),跟随主题。
 */
export function ToolReportCard({ label, content }: ToolReportCardProps) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-card shadow-sm">
      <TerminalChrome label={label} />
      <div className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
        {content ? (
          <pre className="whitespace-pre-wrap break-all">{content}</pre>
        ) : (
          <span className="italic text-muted-foreground/60">(no output)</span>
        )}
      </div>
    </div>
  );
}
