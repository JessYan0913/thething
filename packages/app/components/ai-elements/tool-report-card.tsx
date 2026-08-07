"use client";

import { useState } from "react";
import { TerminalChrome } from "@/components/ai-elements/bash-streaming-card";

interface ToolReportCardProps {
  /** 终端标题栏显示的工具名(如 grep / wiki / cron / github:search_repos) */
  label: string;
  content: string;
  /** 工具入参(JSON 字符串，MCP 等动态工具)，提供 入参 视图回看调用参数 */
  input?: string;
  /** 可选的结构化 JSON 摘要(MCP structuredContent)，提供 JSON 视图 */
  structured?: string;
}

type ReportView = "output" | "input" | "json";

/**
 * 通用工具报告卡:点击工具行内联展开/收起,
 * 用于输出本质是"报告/列表/摘要"而非文件的工具(grep/glob/wiki/cron/skill 等),
 * 替代右侧文件预览面板(那属于文件类工具)。
 * 与 bash 终端卡同视觉(红绿灯标题栏 + 等宽正文),跟随主题。
 * MCP 工具输出走同卡:正文取 content[].text,入参与 structuredContent 通过标题栏切换视图。
 */
export function ToolReportCard({ label, content, input, structured }: ToolReportCardProps) {
  // 可用视图:正文恒有;入参/JSON 按需出现
  const views: ReportView[] = ["output"];
  if (input) views.push("input");
  if (structured) views.push("json");
  const [view, setView] = useState<ReportView>("output");

  const body =
    view === "input" && input ? input :
    view === "json" && structured ? structured :
    content;

  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-card shadow-sm">
      <TerminalChrome
        label={label}
        right={
          views.length > 1 ? (
            <div className="flex items-center gap-0.5">
              {views.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded px-1.5 py-0.5 leading-none transition-colors ${
                    view === v ? "bg-muted-foreground/15 text-foreground" : "hover:bg-muted"
                  }`}
                >
                  {v === "output" ? "正文" : v === "input" ? "入参" : "JSON"}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      <div className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
        {body ? (
          <pre className="whitespace-pre-wrap break-all">{body}</pre>
        ) : (
          <span className="italic text-muted-foreground/60">(no output)</span>
        )}
      </div>
    </div>
  );
}
