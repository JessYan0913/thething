"use client";

/**
 * TodoPanel - Fetches and displays todos from API
 * 
 * Displays todos in collapsible sections grouped by status.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Todo, TodoStatus } from "@/lib/todos/types";
import {
  Collapsible,
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

export function TodoPanel({ conversationId }: { conversationId: string }) {
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [stats, setStats] = React.useState<TodoStats | null>(null);
  const [isOpen, setIsOpen] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchTodos = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/todos?conversationId=${encodeURIComponent(conversationId)}`);
      if (!res.ok) throw new Error("Failed to fetch todos");
      const data: TodosResponse = await res.json();
      setTodos(data.todos);
      setStats(data.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [conversationId]);

  // Poll for todo updates
  React.useEffect(() => {
    fetchTodos();
    const interval = setInterval(fetchTodos, 5000);
    return () => clearInterval(interval);
  }, [fetchTodos]);

  // Group todos by status
  const todosByStatus = React.useMemo(() => {
    const groups: Record<TodoStatus, Todo[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      failed: [],
      cancelled: [],
    };
    for (const todo of todos) {
      groups[todo.status].push(todo);
    }
    return groups;
  }, [todos]);

  const totalTodos = stats
    ? stats.pending + stats.in_progress + stats.completed + stats.failed + stats.cancelled
    : 0;

  if (error) {
    return (
      <div className="shrink-0 border-b p-3 bg-destructive/10 text-destructive text-sm">
        Todo panel error: {error}
      </div>
    );
  }

  // Only show panel when there are todos
  if (totalTodos === 0) {
    return null;
  }

  return (
    <div className="shrink-0 bg-background/95 backdrop-blur">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto">
            {/* In Progress */}
            {todosByStatus.in_progress.length > 0 && (
              <TodoSection
                title="In Progress"
                todos={todosByStatus.in_progress}
                icon={STATUS_ICONS.in_progress}
              />
            )}

            {/* Pending */}
            {todosByStatus.pending.length > 0 && (
              <TodoSection
                title="Pending"
                todos={todosByStatus.pending}
                icon={STATUS_ICONS.pending}
              />
            )}

            {/* Completed */}
            {todosByStatus.completed.length > 0 && (
              <TodoSection
                title="Completed"
                todos={todosByStatus.completed}
                icon={STATUS_ICONS.completed}
                defaultCollapsed
              />
            )}

            {/* Failed */}
            {todosByStatus.failed.length > 0 && (
              <TodoSection
                title="Failed"
                todos={todosByStatus.failed}
                icon={STATUS_ICONS.failed}
                defaultCollapsed
              />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface TodoSectionProps {
  title: string;
  todos: Todo[];
  icon: React.ReactNode;
  defaultCollapsed?: boolean;
}

function TodoSection({ title, todos, icon, defaultCollapsed }: TodoSectionProps) {
  const [isOpen, setIsOpen] = React.useState(!defaultCollapsed);

  if (todos.length === 0) return null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 bg-muted/50 hover:bg-muted transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {icon}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">({todos.length})</span>
        <ChevronDownIcon className={cn(
          "h-3 w-3 ml-auto transition-transform",
          isOpen ? "rotate-180" : ""
        )} />
      </button>
      {isOpen && (
        <div className="divide-y">
          {todos.map((todo) => (
            <TodoItem key={todo.id} todo={todo} />
          ))}
        </div>
      )}
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
