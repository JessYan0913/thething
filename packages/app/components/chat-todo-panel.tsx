"use client";

/**
 * TodoPanel - 流式驱动的任务清单面板
 *
 * 优先使用 streamData（来自 SSE 流的 data-todo-update 事件），
 * 仅在首次加载时做一次 fetch 兜底。不再轮询。
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Todo, TodoStatus } from "@/lib/todos/types";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ListTodo,
} from "lucide-react";

interface TodoStats {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
}

function computeStats(todos: Todo[]): TodoStats {
  const stats: TodoStats = { pending: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const t of todos) {
    if (t.status in stats) stats[t.status as keyof TodoStats]++;
  }
  return stats;
}

const STATUS_CONFIG: Record<TodoStatus, { icon: React.ReactNode; label: string; dot: string; bg: string }> = {
  pending: {
    icon: <Clock className="h-3.5 w-3.5" />,
    label: "待办",
    dot: "bg-gray-400",
    bg: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
  },
  in_progress: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    label: "进行中",
    dot: "bg-blue-500",
    bg: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  },
  completed: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: "已完成",
    dot: "bg-green-500",
    bg: "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  },
  failed: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: "失败",
    dot: "bg-red-500",
    bg: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  },
  cancelled: {
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    label: "已取消",
    dot: "bg-gray-400",
    bg: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
  },
};

const STATUS_PRIORITY: Record<TodoStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  failed: 3,
  cancelled: 4,
};

export function TodoPanel({
  conversationId,
  streamData,
}: {
  conversationId: string;
  streamData: Todo[] | null;
}) {
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [isOpen, setIsOpen] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const initialLoaded = React.useRef(false);

  // 初始加载兜底：streamData 为 null 时做一次 fetch
  React.useEffect(() => {
    if (streamData) {
      setTodos(streamData);
      setError(null);
      initialLoaded.current = true;
    } else if (!initialLoaded.current) {
      fetch(`/api/todos?conversationId=${encodeURIComponent(conversationId)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch todos");
          return res.json() as Promise<{ todos: Todo[] }>;
        })
        .then((data) => {
          setTodos(data.todos);
          setError(null);
          initialLoaded.current = true;
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Unknown error");
        });
    }
  }, [streamData, conversationId]);

  const stats = React.useMemo(() => computeStats(todos), [todos]);

  const sortedTodos = React.useMemo(() => {
    return [...todos].sort((a, b) => {
      const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (diff !== 0) return diff;
      return b.createdAt - a.createdAt;
    });
  }, [todos]);

  // 编号直接用快照里已物化的 todo.number（创建时分配、永不复用，v22 起随快照持久化）——
  // 不再本地按创建序推导，画布/面板/模型三方同源，删除或恢复边界不重排。
  const totalTodos = stats.pending + stats.in_progress + stats.completed + stats.failed + stats.cancelled;
  const activeCount = stats.pending + stats.in_progress;
  const allDone = totalTodos > 0 && activeCount === 0;

  // Auto-collapse when all done
  React.useEffect(() => {
    if (allDone) {
      setIsOpen(false);
    }
  }, [allDone]);

  if (error) {
    return (
      <div className="shrink-0 border rounded-lg p-3 bg-destructive/10 text-destructive text-sm">
        Todo panel error: {error}
      </div>
    );
  }

  if (totalTodos === 0) {
    return null;
  }

  // 构造摘要标签
  const summaryParts: string[] = [];
  if (stats.in_progress > 0) summaryParts.push(`${stats.in_progress} 进行中`);
  if (stats.pending > 0) summaryParts.push(`${stats.pending} 待办`);
  if (stats.completed > 0) summaryParts.push(`${stats.completed} 已完成`);
  if (stats.failed > 0) summaryParts.push(`${stats.failed} 失败`);
  if (stats.cancelled > 0) summaryParts.push(`${stats.cancelled} 已取消`);
  const summaryLabel = summaryParts.join(' · ');

  // 活跃任务数指示
  const hasActive = stats.in_progress > 0 || stats.pending > 0;

  return (
    <div className="shrink-0 bg-background/95 backdrop-blur border border-border/50 rounded-lg overflow-hidden">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex items-center gap-2 w-full px-3 py-2.5 text-sm transition-colors",
            "hover:bg-muted/50 group",
            hasActive ? "border-l-2 border-l-blue-500" : "border-l-2 border-l-transparent",
          )}
        >
          <ListTodo className={cn(
            "h-4 w-4 shrink-0",
            hasActive ? "text-blue-500" : "text-muted-foreground",
          )} />
          <span className="font-medium text-foreground">{summaryLabel}</span>
          <ChevronDown className={cn(
            "h-3.5 w-3.5 ml-auto text-muted-foreground/60 transition-transform group-hover:text-muted-foreground",
            isOpen ? "rotate-180" : "",
          )} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={cn(
            "px-3 pb-2 max-h-64 overflow-y-auto space-y-0.5",
            allDone && "opacity-60",
          )}>
            {sortedTodos.map((todo) => (
              <TodoItem key={todo.id} todo={todo} index={todo.number} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function TodoItem({ todo, index }: { todo: Todo; index?: number }) {
  const cfg = STATUS_CONFIG[todo.status];
  const isDone = todo.status === 'completed' || todo.status === 'cancelled' || todo.status === 'failed';

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors",
        "hover:bg-muted/40",
        isDone && "opacity-60",
      )}
    >
      {/* 状态指示器 */}
      <span className={cn(
        "flex items-center justify-center shrink-0 rounded-full",
        cfg.bg,
        "h-5 w-5",
      )}>
        {cfg.icon}
      </span>

      {/* 内容 */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-sm font-medium truncate",
            todo.status === "cancelled" && "line-through",
            isDone && "text-muted-foreground",
          )}>
            {todo.subject}
          </span>
          {index !== undefined && (
            <span className="text-[11px] text-muted-foreground/50 shrink-0 font-mono">
              #{index}
            </span>
          )}
        </div>

        {todo.metadata?.error && todo.status === "failed" && (
          <p className="text-xs text-red-600 dark:text-red-400 truncate flex items-center gap-1">
            <span className="inline-block w-1 h-1 rounded-full bg-red-500 shrink-0" />
            {String(todo.metadata.error)}
          </p>
        )}
        {todo.metadata?.result && todo.status === "completed" && (
          <p className="text-xs text-muted-foreground truncate">{String(todo.metadata.result)}</p>
        )}
      </div>
    </div>
  );
}