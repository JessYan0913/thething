"use client";

/**
 * TaskPanel - Fetches and displays tasks from API
 * 
 * Displays tasks in collapsible sections grouped by status.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/tasks/types";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronDownIcon,
  ListTodo,
} from "lucide-react";

interface TaskStats {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface TasksResponse {
  tasks: Task[];
  stats: TaskStats;
}

const STATUS_ICONS: Record<TaskStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-gray-400" />,
  in_progress: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <AlertCircle className="h-4 w-4 text-gray-400" />,
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "text-gray-400",
  in_progress: "text-blue-500",
  completed: "text-green-500",
  failed: "text-red-500",
  cancelled: "text-gray-400",
};

export function TaskPanel() {
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [stats, setStats] = React.useState<TaskStats | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchTasks = React.useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const data: TasksResponse = await res.json();
      setTasks(data.tasks);
      setStats(data.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  // Poll for task updates
  React.useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

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

  const totalTasks = stats
    ? stats.pending + stats.in_progress + stats.completed + stats.failed + stats.cancelled
    : 0;

  if (error) {
    return (
      <div className="shrink-0 border-b p-3 bg-destructive/10 text-destructive text-sm">
        Task panel error: {error}
      </div>
    );
  }

  const hasTasks = totalTasks > 0;

  return (
    <div className="shrink-0 border-b bg-background/95 backdrop-blur">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 p-3 hover:bg-muted/50 transition-colors">
          <ListTodo className="h-4 w-4" />
          <span className="font-medium text-sm">Tasks ({totalTasks})</span>
          {stats && (
            <span className="text-xs text-muted-foreground">
              {stats.in_progress > 0 && `${stats.in_progress} in progress • `}
              {stats.pending > 0 && `${stats.pending} pending`}
              {stats.completed > 0 && ` • ${stats.completed} done`}
            </span>
          )}
          <ChevronDownIcon className="h-4 w-4 ml-auto transition-transform data-[state=open]:rotate-180" />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto">
            {!hasTasks ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No tasks yet. Ask AI to create a task!
              </div>
            ) : (
              <>
                {/* In Progress */}
                {tasksByStatus.in_progress.length > 0 && (
                  <TaskSection
                    title="In Progress"
                    tasks={tasksByStatus.in_progress}
                    icon={STATUS_ICONS.in_progress}
                  />
                )}

                {/* Pending */}
                {tasksByStatus.pending.length > 0 && (
                  <TaskSection
                    title="Pending"
                    tasks={tasksByStatus.pending}
                    icon={STATUS_ICONS.pending}
                  />
                )}

                {/* Completed */}
                {tasksByStatus.completed.length > 0 && (
                  <TaskSection
                    title="Completed"
                    tasks={tasksByStatus.completed}
                    icon={STATUS_ICONS.completed}
                    defaultCollapsed
                  />
                )}

                {/* Failed */}
                {tasksByStatus.failed.length > 0 && (
                  <TaskSection
                    title="Failed"
                    tasks={tasksByStatus.failed}
                    icon={STATUS_ICONS.failed}
                    defaultCollapsed
                  />
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface TaskSectionProps {
  title: string;
  tasks: Task[];
  icon: React.ReactNode;
  defaultCollapsed?: boolean;
}

function TaskSection({ title, tasks, icon, defaultCollapsed }: TaskSectionProps) {
  const [isOpen, setIsOpen] = React.useState(!defaultCollapsed);

  if (tasks.length === 0) return null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 bg-muted/50 hover:bg-muted transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {icon}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">({tasks.length})</span>
        <ChevronDownIcon className={cn(
          "h-3 w-3 ml-auto transition-transform",
          isOpen ? "rotate-180" : ""
        )} />
      </button>
      {isOpen && (
        <div className="divide-y">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskItem({ task }: { task: Task }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 hover:bg-muted/50 transition-colors">
      <span className={cn("mt-0.5", STATUS_COLORS[task.status])}>
        {STATUS_ICONS[task.status]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm truncate">{task.subject}</span>
          <span className="text-xs text-muted-foreground shrink-0">#{task.id}</span>
        </div>
        {task.activeForm && (
          <p className="text-xs text-blue-600 truncate">{task.activeForm}</p>
        )}
        {task.metadata?.error && task.status === "failed" && (
          <p className="text-xs text-red-600 truncate">{task.metadata.error as string}</p>
        )}
        {task.metadata?.result && (
          <p className="text-xs text-muted-foreground truncate">{task.metadata.result as string}</p>
        )}
      </div>
    </div>
  );
}
