"use client";

import { cn } from "@/lib/utils";
import { memo, useMemo, useState } from "react";

interface TerminalJsonProps {
  /** JSON 数据 */
  data: unknown;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 最大行数限制（超过则折叠） */
  maxLines?: number;
  /** 额外类名 */
  className?: string;
}

// 终端配色方案
const TERMINAL_COLORS = {
  key: "text-emerald-400",        // 绿色 - 对象键
  string: "text-amber-300",       // 琥珀色 - 字符串值
  number: "text-cyan-400",        // 青色 - 数字
  boolean: "text-purple-400",     // 紫色 - 布尔值
  null: "text-red-400",           // 红色 - null
  bracket: "text-slate-400",      // 灰色 - 括号
  comma: "text-slate-500",        // 深灰 - 逗号
  colon: "text-slate-500",        // 深灰 - 冒号
  lineNumber: "text-slate-600",   // 深灰 - 行号
};

// 语法化 JSON 渲染
const JsonToken = memo(({ value, type }: { value: string; type: string }) => {
  const colorClass = TERMINAL_COLORS[type as keyof typeof TERMINAL_COLORS] || "text-slate-300";
  return <span className={colorClass}>{value}</span>;
});
JsonToken.displayName = "JsonToken";

// 单行 JSON 渲染
const JsonLine = memo(({ 
  line, 
  lineNumber, 
  showLineNumbers,
  indent 
}: { 
  line: string; 
  lineNumber: number; 
  showLineNumbers: boolean;
  indent: number;
}) => {
  // 简单的语法高亮
  const tokens = useMemo(() => {
    const result: Array<{ value: string; type: string }> = [];
    let i = 0;
    const trimmed = line.trimStart();
    const currentIndent = line.length - trimmed.length;

    // 添加缩进
    if (currentIndent > 0) {
      result.push({ value: line.slice(0, currentIndent), type: "bracket" });
    }

    while (i < trimmed.length) {
      const char = trimmed[i];

      // 字符串
      if (char === '"') {
        let j = i + 1;
        while (j < trimmed.length && trimmed[j] !== '"') {
          if (trimmed[j] === '\\') j++;
          j++;
        }
        const str = trimmed.slice(i, j + 1);
        
        // 检查是否是键（后面跟着冒号）
        const rest = trimmed.slice(j + 1).trimStart();
        if (rest.startsWith(':')) {
          result.push({ value: str, type: "key" });
        } else {
          result.push({ value: str, type: "string" });
        }
        i = j + 1;
        continue;
      }

      // 数字
      if (/[\d\-]/.test(char)) {
        let j = i;
        while (j < trimmed.length && /[\d.\-eE\+]/.test(trimmed[j])) j++;
        result.push({ value: trimmed.slice(i, j), type: "number" });
        i = j;
        continue;
      }

      // 布尔值
      if (trimmed.slice(i, i + 4) === 'true') {
        result.push({ value: 'true', type: "boolean" });
        i += 4;
        continue;
      }
      if (trimmed.slice(i, i + 5) === 'false') {
        result.push({ value: 'false', type: "boolean" });
        i += 5;
        continue;
      }

      // null
      if (trimmed.slice(i, i + 4) === 'null') {
        result.push({ value: 'null', type: "null" });
        i += 4;
        continue;
      }

      // 括号
      if ('{}[]'.includes(char)) {
        result.push({ value: char, type: "bracket" });
        i++;
        continue;
      }

      // 冒号
      if (char === ':') {
        result.push({ value: ':', type: "colon" });
        i++;
        continue;
      }

      // 逗号
      if (char === ',') {
        result.push({ value: ',', type: "comma" });
        i++;
        continue;
      }

      // 其他字符（空格等）
      result.push({ value: char, type: "bracket" });
      i++;
    }

    return result;
  }, [line]);

  return (
    <div className="flex hover:bg-white/5 transition-colors">
      {showLineNumbers && (
        <span className={cn(
          "select-none text-right pr-4 min-w-[2.5rem] shrink-0",
          TERMINAL_COLORS.lineNumber
        )}>
          {lineNumber}
        </span>
      )}
      <code className="flex-1 break-words whitespace-pre-wrap overflow-hidden">
        {tokens.map((token, idx) => (
          <JsonToken key={idx} value={token.value} type={token.type} />
        ))}
      </code>
    </div>
  );
});
JsonLine.displayName = "JsonLine";

// 格式化 JSON 为带缩进的行
function formatJsonToLines(data: unknown): string[] {
  try {
    const formatted = JSON.stringify(data, null, 2);
    return formatted.split('\n');
  } catch {
    return [String(data)];
  }
}

export const TerminalJson = memo(({
  data,
  showLineNumbers = true,
  maxLines = 50,
  className,
}: TerminalJsonProps) => {
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(() => formatJsonToLines(data), [data]);
  const isCollapsed = lines.length > maxLines && !expanded;
  const displayLines = isCollapsed ? lines.slice(0, maxLines) : lines;

  return (
    <div className={cn(
      "rounded-lg border border-slate-700/50 bg-slate-900/95 overflow-hidden",
      className
    )}>
      {/* 终端标题栏 */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/80 border-b border-slate-700/50">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <span className="text-xs text-slate-400 font-mono ml-2">JSON Output</span>
      </div>

      {/* 内容区域 */}
      <div className="max-h-[400px] overflow-y-auto">
        <div className="p-4 font-mono text-sm leading-relaxed break-all">
          {displayLines.map((line, idx) => (
            <JsonLine
              key={idx}
              line={line}
              lineNumber={idx + 1}
              showLineNumbers={showLineNumbers}
              indent={0}
            />
          ))}
        </div>
      </div>

      {/* 展开/折叠按钮 */}
      {lines.length > maxLines && (
        <div className="flex justify-center py-2 border-t border-slate-700/50 bg-slate-800/50">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-3 py-1 rounded hover:bg-slate-700/50"
          >
            {expanded ? `▲ 收起 (${lines.length} 行)` : `▼ 展开全部 (${lines.length} 行)`}
          </button>
        </div>
      )}
    </div>
  );
});

TerminalJson.displayName = "TerminalJson";

export default TerminalJson;
