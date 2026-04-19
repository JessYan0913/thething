"use client";

/**
 * TaskPanel - Task list display component
 * 
 * Displays tasks grouped by status with actions.
 * Uses the existing UI component patterns (shadcn-style with Radix UI).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/tasks/types";
import { STATUS_CONFIG } from "@/lib/tasks/types";
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
 * TaskPanel Props
 */
export interface TaskPanelProps {
  /** All tasks to display */
  tasks: Task[];
  /** Callback when claim action is triggered */
  onClaim: (taskId: string) => void;
  /** Callback when complete action is triggered */
  onComplete: (taskId: string) => void;
  /** Callback when stop action is triggered */
  onStop: (taskId: string) => void;
  /** Callback when delete action is triggered */
  onDelete: (taskId: string) => void;
  /** Callback when retry action is triggered */
  onRetry?: (taskId: string) => void;
  /** Callback when task is clicked */
  onTaskClick?: (task: Task) => void;
  /** Class name for the container */
  className?: string;
}

/**
 * Status icon mapping
 */
const STATUS_ICONS: Record<TaskStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-gray-400" />,
  in_progress: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <AlertCircle className="h-4 w-4 text-gray-400" />,
};

/**
 * TaskPanel component
 */
export function TaskPanel({
  tasks,
  onClaim,
  onComplete,
  onStop,
  onDelete,
  onRetry,
  onTaskClick,
  className,
}: TaskPanelProps) {
  // Group tasks by status
  const tasksByStatus = React.useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      failed: [],
      cancelled: [],
    };
    
    for (const task of tasks) {
      groups[task.status].push(task);
    }
    
    return groups;
  }, [tasks]);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* In Progress */}
      <TaskSection
        title="In Progress"
        icon={STATUS_ICONS.in_progress}
        tasks={tasksByStatus.in_progress}
        actions={[
          { label: "Complete", onClick: onComplete },
          { label: "Stop", onClick: onStop },
        ]}
        onTaskClick={onTaskClick}
        defaultOpen={true}
      />

      {/* Pending */}
      <TaskSection
        title="Pending"
        icon={STATUS_ICONS.pending}
        tasks={tasksByStatus.pending}
        actions={onClaim ? [{ label: "Claim", onClick: onClaim }] : []}
        onTaskClick={onTaskClick}
        defaultOpen={true}
        showBlockedBy
      />

      {/* Completed */}
      <TaskSection
        title="Completed"
        icon={STATUS_ICONS.completed}
        tasks={tasksByStatus.completed}
        onTaskClick={onTaskClick}
        defaultOpen={false}
      />

      {/* Failed */}
      {tasksByStatus.failed.length > 0 && (
        <TaskSection
          title="Failed"
          icon={STATUS_ICONS.failed}
          tasks={tasksByStatus.failed}
          actions={[
            ...(onRetry ? [{ label: "Retry", onClick: onRetry }] : []),
            { label: "Delete", onClick: onDelete },
          ]}
          onTaskClick={onTaskClick}
          defaultOpen={false}
        />
      )}

      {/* Cancelled */}
      {tasksByStatus.cancelled.length > 0 && (
        <TaskSection
          title="Cancelled"
          icon={STATUS_ICONS.cancelled}
          tasks={tasksByStatus.cancelled}
          actions={[{ label: "Delete", onClick: onDelete }]}
          onTaskClick={onTaskClick}
          defaultOpen={false}
        />
      )}
    </div>
  );
}

/**
 * TaskSection Props
 */
interface TaskSectionProps {
  title: string;
  icon: React.ReactNode;
  tasks: Task[];
  actions?: Array<{ label: string; onClick: (taskId: string) => void }>;
  onTaskClick?: (task: Task) => void;
  defaultOpen?: boolean;
  showBlockedBy?: boolean;
}

/**
 * Collapsible task section
 */
function TaskSection({
  title,
  icon,
  tasks,
  actions = [],
  onTaskClick,
  defaultOpen = true,
  showBlockedBy = false,
}: TaskSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  if (tasks.length === 0) return null;

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
        <span className="text-sm text-muted-foreground">({tasks.length})</span>
      </button>

      {/* Section Content */}
      {isOpen && (
        <div className="divide-y">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              actions={actions}
              onClick={() => onTaskClick?.(task)}
              showBlockedBy={showBlockedBy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * TaskItem Props
 */
interface TaskItemProps {
  task: Task;
  actions: Array<{ label: string; onClick: (taskId: string) => void }>;
  onClick?: () => void;
  showBlockedBy?: boolean;
}

/**
 * Single task item
 */
function TaskItem({ task, actions, onClick, showBlockedBy }: TaskItemProps) {
  const config = STATUS_CONFIG[task.status];

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      {/* Status Indicator */}
      <div className={cn("mt-0.5", config.color)}>
        <span className="text-lg">{config.icon}</span>
      </div>

      {/* Task Content */}
      <div className="flex-1 min-w-0">
        {/* Subject and ID */}
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{task.subject}</span>
          <span className="text-xs text-muted-foreground shrink-0">#{task.id}</span>
        </div>

        {/* Active Form */}
        {task.activeForm && task.status === "in_progress" && (
          <p className="text-sm text-blue-600 mt-1 truncate">{task.activeForm}</p>
        )}

        {/* Blocked By */}
        {showBlockedBy && task.blockedBy.length > 0 && (
          <p className="text-sm text-amber-600 mt-1">
            Blocked by: {task.blockedBy.join(", ")}
          </p>
        )}

        {/* Error */}
        {task.status === "failed" && task.metadata?.error && (
          <p className="text-sm text-red-600 mt-1 truncate">{task.metadata.error as string}</p>
        )}

        {/* Result */}
        {task.metadata?.result && (
          <p className="text-sm text-muted-foreground mt-1 truncate">
            {task.metadata.result as string}
          </p>
        )}

        {/* Metadata: Priority, Tags */}
        {(task.metadata?.priority || task.metadata?.tags) && (
          <div className="flex gap-2 mt-2">
            {task.metadata?.priority && (
              <PriorityBadge priority={task.metadata.priority as "low" | "medium" | "high"} />
            )}
            {(task.metadata?.tags as string[])?.map((tag) => (
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
                action.onClick(task.id);
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
 * Task Summary - Shows counts for each status
 */
export function TaskSummary({ tasks }: { tasks: Task[] }) {
  const counts = React.useMemo(() => {
    const result: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    
    for (const task of tasks) {
      result[task.status]++;
    }
    
    return result;
  }, [tasks]);

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
