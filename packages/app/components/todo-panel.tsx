"use client";

/**
 * TodoPanel - Todo list display component
 * 
 * Displays todos grouped by status with actions.
 * Uses the existing UI component patterns (shadcn-style with Radix UI).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Todo, TodoStatus } from "@/lib/todos/types";
import { STATUS_CONFIG, STATUS_STYLES } from "@/lib/todos/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

/**
 * TodoPanel Props
 */
export interface TodoPanelProps {
  /** All todos to display */
  todos: Todo[];
  /** Callback when claim action is triggered */
  onClaim: (todoId: string) => void;
  /** Callback when complete action is triggered */
  onComplete: (todoId: string) => void;
  /** Callback when stop action is triggered */
  onStop: (todoId: string) => void;
  /** Callback when delete action is triggered */
  onDelete: (todoId: string) => void;
  /** Callback when retry action is triggered */
  onRetry?: (todoId: string) => void;
  /** Callback when todo is clicked */
  onTodoClick?: (todo: Todo) => void;
  /** Class name for the container */
  className?: string;
}

/**
 * Status icon mapping
 */
const STATUS_ICONS: Record<TodoStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-gray-400" />,
  in_progress: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <AlertCircle className="h-4 w-4 text-gray-400" />,
};

/**
 * TodoPanel component
 */
export function TodoPanel({
  todos,
  onClaim,
  onComplete,
  onStop,
  onDelete,
  onRetry,
  onTodoClick,
  className,
}: TodoPanelProps) {
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

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* In Progress */}
      <TodoSection
        title="In Progress"
        icon={STATUS_ICONS.in_progress}
        todos={todosByStatus.in_progress}
        actions={[
          { label: "Complete", onClick: onComplete },
          { label: "Stop", onClick: onStop },
        ]}
        onTodoClick={onTodoClick}
        defaultOpen={true}
      />

      {/* Pending */}
      <TodoSection
        title="Pending"
        icon={STATUS_ICONS.pending}
        todos={todosByStatus.pending}
        actions={onClaim ? [{ label: "Claim", onClick: onClaim }] : []}
        onTodoClick={onTodoClick}
        defaultOpen={true}
        showBlockedBy
      />

      {/* Completed */}
      <TodoSection
        title="Completed"
        icon={STATUS_ICONS.completed}
        todos={todosByStatus.completed}
        onTodoClick={onTodoClick}
        defaultOpen={false}
      />

      {/* Failed */}
      {todosByStatus.failed.length > 0 && (
        <TodoSection
          title="Failed"
          icon={STATUS_ICONS.failed}
          todos={todosByStatus.failed}
          actions={[
            ...(onRetry ? [{ label: "Retry", onClick: onRetry }] : []),
            { label: "Delete", onClick: onDelete },
          ]}
          onTodoClick={onTodoClick}
          defaultOpen={false}
        />
      )}

      {/* Cancelled */}
      {todosByStatus.cancelled.length > 0 && (
        <TodoSection
          title="Cancelled"
          icon={STATUS_ICONS.cancelled}
          todos={todosByStatus.cancelled}
          actions={[{ label: "Delete", onClick: onDelete }]}
          onTodoClick={onTodoClick}
          defaultOpen={false}
        />
      )}
    </div>
  );
}

/**
 * TodoSection Props
 */
interface TodoSectionProps {
  title: string;
  icon: React.ReactNode;
  todos: Todo[];
  actions?: Array<{ label: string; onClick: (todoId: string) => void }>;
  onTodoClick?: (todo: Todo) => void;
  defaultOpen?: boolean;
  showBlockedBy?: boolean;
}

/**
 * Collapsible todo section
 */
function TodoSection({
  title,
  icon,
  todos,
  actions = [],
  onTodoClick,
  defaultOpen = true,
  showBlockedBy = false,
}: TodoSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  if (todos.length === 0) return null;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Section Header */}
      <button
        className="flex items-center gap-2 w-full px-4 py-3 bg-muted/50 hover:bg-muted transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        {icon}
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">({todos.length})</span>
      </button>

      {/* Section Content */}
      {isOpen && (
        <div className="divide-y">
          {todos.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              actions={actions}
              onClick={() => onTodoClick?.(todo)}
              showBlockedBy={showBlockedBy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * TodoItem Props
 */
interface TodoItemProps {
  todo: Todo;
  actions: Array<{ label: string; onClick: (todoId: string) => void }>;
  onClick?: () => void;
  showBlockedBy?: boolean;
}

/**
 * Single todo item
 */
function TodoItem({ todo, actions, onClick, showBlockedBy }: TodoItemProps) {
  const config = STATUS_CONFIG[todo.status];

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      {/* Status Indicator */}
      <div className={cn("mt-0.5", STATUS_STYLES[todo.status].color)}>
        <span className="text-lg">{config.icon}</span>
      </div>

      {/* Todo Content */}
      <div className="flex-1 min-w-0">
        {/* Subject and ID */}
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{todo.subject}</span>
          <span className="text-xs text-muted-foreground shrink-0">#{todo.id}</span>
        </div>

        {/* Active Form */}
        {todo.activeForm && todo.status === "in_progress" && (
          <p className="text-sm text-blue-600 mt-1 truncate">{todo.activeForm}</p>
        )}

        {/* Blocked By */}
        {showBlockedBy && todo.blockedBy.length > 0 && (
          <p className="text-sm text-amber-600 mt-1">
            Blocked by: {todo.blockedBy.join(", ")}
          </p>
        )}

        {/* Error */}
        {todo.status === "failed" && todo.metadata?.error && (
          <p className="text-sm text-red-600 mt-1 truncate">{todo.metadata.error as string}</p>
        )}

        {/* Result */}
        {todo.metadata?.result && (
          <p className="text-sm text-muted-foreground mt-1 truncate">
            {todo.metadata.result as string}
          </p>
        )}

        {/* Metadata: Priority, Tags */}
        {(todo.metadata?.priority || todo.metadata?.tags) && (
          <div className="flex gap-2 mt-2">
            {todo.metadata?.priority && (
              <PriorityBadge priority={todo.metadata.priority as "low" | "medium" | "high"} />
            )}
            {(todo.metadata?.tags as string[])?.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex gap-2 shrink-0">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                action.onClick(todo.id);
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Priority Badge
 */
function PriorityBadge({ priority }: { priority: "low" | "medium" | "high" }) {
  const colors = {
    low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-500",
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-500",
  };

  return (
    <span className={cn("text-xs px-2 py-0.5 rounded", colors[priority])}>
      {priority}
    </span>
  );
}

/**
 * Tag Badge
 */
function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
      {tag}
    </span>
  );
}

/**
 * Todo Summary - Shows counts for each status
 */
export function TodoSummary({ todos }: { todos: Todo[] }) {
  const counts = React.useMemo(() => {
    const result: Record<TodoStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    
    for (const todo of todos) {
      result[todo.status]++;
    }
    
    return result;
  }, [todos]);

  return (
    <div className="flex gap-4 text-sm">
      <div className="flex items-center gap-1">
        {STATUS_ICONS.in_progress}
        <span>{counts.in_progress} in progress</span>
      </div>
      <div className="flex items-center gap-1">
        {STATUS_ICONS.pending}
        <span>{counts.pending} pending</span>
      </div>
      <div className="flex items-center gap-1">
        {STATUS_ICONS.completed}
        <span>{counts.completed} completed</span>
      </div>
      {counts.failed > 0 && (
        <div className="flex items-center gap-1 text-red-600">
          {STATUS_ICONS.failed}
          <span>{counts.failed} failed</span>
        </div>
      )}
    </div>
  );
}
