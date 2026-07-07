"use client";

import { cn } from "@/lib/utils";
import { memo, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

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

// 语法化 JSON 渲染
const JsonToken = memo(({ value, type }: { value: string; type: string }) => {
  const colorClass = {
    key: "text-emerald-600 dark:text-emerald-400",
    string: "text-amber-600 dark:text-amber-400",
    number: "text-cyan-600 dark:text-cyan-400",
    boolean: "text-purple-600 dark:text-purple-400",
    null: "text-red-600 dark:text-red-400",
    bracket: "text-muted-foreground",
    comma: "text-muted-foreground/60",
    colon: "text-muted-foreground/60",
  }[type] ?? "text-foreground";

  return <span className={colorClass}>{value}</span>;
});
JsonToken.displayName = "JsonToken";

// 单行 JSON 渲染
const JsonLine = memo(({
  line,
  lineNumber,
  showLineNumbers,
}: {
  line: string;
  lineNumber: number;
  showLineNumbers: boolean;
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
    <div className="flex hover:bg-accent/30 transition-colors">
      {showLineNumbers && (
        <span className="select-none text-right pr-4 min-w-[2.5rem] shrink-0 text-muted-foreground/50 font-mono text-xs">
          {lineNumber}
        </span>
      )}
      <code className="flex-1 break-words whitespace-pre-wrap overflow-hidden text-xs font-mono">
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
      "rounded-md border overflow-hidden bg-card font-mono text-xs",
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-medium">Output</span>
          <span className="text-muted-foreground/60">({lines.length} lines)</span>
        </div>
        {lines.length > maxLines && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <>
                <ChevronDownIcon className="size-3" />
                <span>Collapse</span>
              </>
            ) : (
              <>
                <ChevronRightIcon className="size-3" />
                <span>Expand all</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        <div className="p-3 leading-relaxed">
          {displayLines.map((line, idx) => (
            <JsonLine
              key={idx}
              line={line}
              lineNumber={idx + 1}
              showLineNumbers={showLineNumbers}
            />
          ))}
        </div>
      </div>

      {/* Truncation info */}
      {isCollapsed && (
        <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground text-center">
          Showing {maxLines} of {lines.length} lines
        </div>
      )}
    </div>
  );
});

TerminalJson.displayName = "TerminalJson";

export default TerminalJson;
