"use client";

import { Loader2Icon } from "lucide-react";

const TAIL_LINES = 12;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 剥离 ANSI 转义序列(颜色/光标控制),避免终端控制码显示为乱码 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

/** macOS 终端风格的红绿灯 + 标题栏(跟随主题)。label 默认 "bash",报告类工具传工具名 */
export function TerminalChrome({ label = "bash", right }: { label?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
      <div className="flex gap-1.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
      </div>
      <span className="ml-1 text-xs text-muted-foreground">{label}</span>
      {right && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{right}</span>}
    </div>
  );
}

/** 终端提示符 + 命令行 */
function PromptLine({ command }: { command?: string }) {
  return (
    <div className="whitespace-pre-wrap break-all">
      <span className="select-none text-success">$ </span>
      <span className="text-foreground">{command ?? ""}</span>
    </div>
  );
}

interface BashStreamingCardProps {
  command?: string;
  tail: string;
  bytes: number;
  elapsedMs: number;
}

/**
 * bash 执行期间的实时输出预览卡:
 * 展示 data-bash-output 直播帧(stdout/stderr 合并尾部)的最后 N 行,
 * 工具结果到达后由常规结果行替换。
 */
export function BashStreamingCard({ command, tail, bytes, elapsedMs }: BashStreamingCardProps) {
  const lines = stripAnsi(tail).replace(/\n$/, "").split("\n");
  const tailLines = lines.slice(-TAIL_LINES);
  const truncatedTop = lines.length > TAIL_LINES;

  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-card shadow-sm">
      <TerminalChrome
        right={
          <span className="flex items-center gap-1.5">
            <Loader2Icon className="size-3 animate-spin text-success" />
            {formatSize(bytes)} · {(elapsedMs / 1000).toFixed(1)}s
          </span>
        }
      />
      <div className="overflow-x-auto px-3 py-2 font-mono text-xs leading-5">
        <PromptLine command={command} />
        {truncatedTop && <div className="select-none text-muted-foreground/50">…</div>}
        {tailLines.map((line, i) => {
          const isLast = i === tailLines.length - 1;
          return (
            <div key={i} className="whitespace-pre text-muted-foreground">
              {line}
              {isLast && <span className="animate-pulse text-foreground">▌</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface BashOutputCardProps {
  command?: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/**
 * bash 完成后的内联输出卡:点击工具行展开/收起,
 * 与直播卡同视觉(终端风格),替代右侧文件预览面板。
 */
export function BashOutputCard({ command, stdout, stderr, exitCode }: BashOutputCardProps) {
  const failed = exitCode !== undefined && exitCode !== 0;
  const cleanStdout = stripAnsi(stdout).replace(/\n$/, "");
  const cleanStderr = stripAnsi(stderr).replace(/\n$/, "");

  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-card shadow-sm">
      <TerminalChrome
        right={
          <span className={failed ? "text-destructive" : "text-success"}>
            {failed ? `exit ${exitCode}` : "✓"}
          </span>
        }
      />
      <div className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-5">
        <PromptLine command={command} />
        {cleanStdout && <pre className="whitespace-pre-wrap break-all text-muted-foreground">{cleanStdout}</pre>}
        {cleanStderr && <pre className="whitespace-pre-wrap break-all text-destructive/90">{cleanStderr}</pre>}
        {!cleanStdout && !cleanStderr && <div className="italic text-muted-foreground/60">(no output)</div>}
      </div>
    </div>
  );
}
