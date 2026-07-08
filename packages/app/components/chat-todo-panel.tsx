"use client";

/**
 * TodoPanel - Fetches and displays todos from API
 * 
 * Single list sorted by status: in_progress first, then others.
 * When all todos are done, shows collapsed summary.
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
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronDownIcon,
} from "lucide-react";

interface TodoStats {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface TodosResponse {
  todos: Todo[];
  stats: TodoStats;
}

const STATUS_ICONS: Record<TodoStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-gray-400" />,
  in_progress: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <AlertCircle className="h-4 w-4 text-gray-400" />,
};

const STATUS_COLORS: Record<TodoStatus, string> = {
  pending: "text-gray-400",
  in_progress: "text-blue-500",
  completed: "text-green-500",
  failed: "text-red-500",
  cancelled: "text-gray-400",
};

const STATUS_PRIORITY: Record<TodoStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  failed: 3,
  cancelled: 4,
};

function isDoneStatus(status: TodoStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function TodoPanel({ conversationId }: { conversationId: string }) {
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [stats, setStats] = React.useState<TodoStats | null>(null);
  const [isOpen, setIsOpen] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const lastDataRef = React.useRef<string>('');

  const fetchTodos = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/todos?conversationId=${encodeURIComponent(conversationId)}`);
      if (!res.ok) throw new Error("Failed to fetch todos");
      const data: TodosResponse = await res.json();
      const serialized = JSON.stringify(data);
      if (serialized !== lastDataRef.current) {
        lastDataRef.current = serialized;
        setTodos(data.todos);
        setStats(data.stats);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [conversationId]);

  React.useEffect(() => {
    fetchTodos();
    const interval = setInterval(fetchTodos, 5000);
    return () => clearInterval(interval);
  }, [fetchTodos]);

  const sortedTodos = React.useMemo(() => {
    return [...todos].sort((a, b) => {
      const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (diff !== 0) return diff;
      return b.createdAt - a.createdAt;
    });
  }, [todos]);

  const totalTodos = stats
    ? stats.pending + stats.in_progress + stats.completed + stats.failed + stats.cancelled
    : 0;

  const activeCount = stats ? stats.pending + stats.in_progress : 0;
  const doneCount = stats ? stats.completed + stats.failed + stats.cancelled : 0;
  const allDone = totalTodos > 0 && activeCount === 0;

  // Auto-collapse when all done
  React.useEffect(() => {
    if (allDone) {
      setIsOpen(false);
    }
  }, [allDone]);

  if (error) {
    return (
      <div className="shrink-0 border-b p-3 bg-destructive/10 text-destructive text-sm">
        Todo panel error: {error}
      </div>
    );
  }

  if (totalTodos === 0) {
    return null;
  }

  // All done - show collapsed summary
  if (allDone) {
    return (
      <div className="shrink-0 bg-background/95 backdrop-blur">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span>任务已完成 ({doneCount})</span>
            <ChevronDownIcon className={cn(
              "h-3 w-3 ml-auto transition-transform",
              isOpen ? "rotate-180" : ""
            )} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-3 pb-3 max-h-64 overflow-y-auto divide-y opacity-60">
              {sortedTodos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  // Active todos - show expanded
  return (
    <div className="shrink-0 bg-background/95 backdrop-blur">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleContent>
          <div className="px-3 pb-3 max-h-64 overflow-y-auto divide-y">
            {sortedTodos.map((todo) => (
              <TodoItem key={todo.id} todo={todo} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function TodoItem({ todo }: { todo: Todo }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 hover:bg-muted/50 transition-colors">
      <span className={cn("mt-0.5", STATUS_COLORS[todo.status])}>
        {STATUS_ICONS[todo.status]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm truncate">{todo.subject}</span>
          <span className="text-xs text-muted-foreground shrink-0">#{todo.id}</span>
        </div>
        {todo.activeForm && (
          <p className="text-xs text-blue-600 truncate">{todo.activeForm}</p>
        )}
        {todo.metadata?.error && todo.status === "failed" && (
          <p className="text-xs text-red-600 truncate">{todo.metadata.error as string}</p>
        )}
        {todo.metadata?.result && (
          <p className="text-xs text-muted-foreground truncate">{todo.metadata.result as string}</p>
        )}
      </div>
    </div>
  );
}
