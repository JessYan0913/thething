"use client";

/**
 * TaskDependencyTree - Visualize task dependencies
 * 
 * Shows the dependency chain of tasks in a tree structure.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/tasks/types";
import { STATUS_CONFIG } from "@/lib/tasks/types";

/**
 * TaskDependencyTree Props
 */
export interface TaskDependencyTreeProps {
  /** All tasks */
  tasks: Task[];
  /** Root task ID to start from */
  rootTaskId: string;
  /** Callback when a task is clicked */
  onTaskClick?: (task: Task) => void;
  /** Show blocks (dependents) instead of blockedBy (dependencies) */
  showBlocks?: boolean;
  /** Class name */
  className?: string;
}

/**
 * TaskDependencyTree component
 */
export function TaskDependencyTree({
  tasks,
  rootTaskId,
  onTaskClick,
  showBlocks = false,
  className,
}: TaskDependencyTreeProps) {
  const taskMap = React.useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) {
      map.set(task.id, task);
    }
    return map;
  }, [tasks]);

  const rootTask = taskMap.get(rootTaskId);
  if (!rootTask) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        Task {rootTaskId} not found
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {showBlocks
        ? renderBlockingTree(rootTask, taskMap, onTaskClick, 0)
        : renderBlockedByTree(rootTask, taskMap, onTaskClick, 0)}
    </div>
  );
}

/**
 * Render tree showing blockedBy (dependencies)
 */
function renderBlockedByTree(
  task: Task,
  taskMap: Map<string, Task>,
  onTaskClick: ((task: Task) => void) | undefined,
  depth: number
): React.ReactNode {
  const blockedByTasks = task.blockedBy
    .map((id) => taskMap.get(id))
    .filter((t): t is Task => t !== undefined);

  return (
    <div key={task.id} style={{ marginLeft: depth * 24 }}>
      <TaskTreeItem task={task} onClick={() => onTaskClick?.(task)} />
      {blockedByTasks.map((dep) =>
        renderBlockedByTree(dep, taskMap, onTaskClick, depth + 1)
      )}
    </div>
  );
}

/**
 * Render tree showing blocks (dependents)
 */
function renderBlockingTree(
  task: Task,
  taskMap: Map<string, Task>,
  onTaskClick: ((task: Task) => void) | undefined,
  depth: number
): React.ReactNode {
  const blockingTasks = task.blocks
    .map((id) => taskMap.get(id))
    .filter((t): t is Task => t !== undefined);

  return (
    <div key={task.id} style={{ marginLeft: depth * 24 }}>
      <TaskTreeItem task={task} onClick={() => onTaskClick?.(task)} />
      {blockingTasks.map((dep) =>
        renderBlockingTree(dep, taskMap, onTaskClick, depth + 1)
      )}
    </div>
  );
}

/**
 * TaskTreeItem Props
 */
interface TaskTreeItemProps {
  task: Task;
  onClick?: () => void;
}

/**
 * Single task item in the tree
 */
function TaskTreeItem({ task, onClick }: TaskTreeItemProps) {
  const config = STATUS_CONFIG[task.status];

  return (
    <div
      className={cn(
        "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted transition-colors",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      <span className={cn("text-lg", config.color)}>{config.icon}</span>
      <span className="font-medium truncate">{task.subject}</span>
      <span className="text-xs text-muted-foreground shrink-0">#{task.id}</span>
      {task.status === "in_progress" && task.activeForm && (
        <span className="text-xs text-blue-500 truncate">({task.activeForm})</span>
      )}
    </div>
  );
}

/**
 * TaskDependencyGraph - Shows full dependency graph
 * 
 * Renders all tasks grouped by their dependency relationships.
 */
export interface TaskDependencyGraphProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  className?: string;
}

export function TaskDependencyGraph({
  tasks,
  onTaskClick,
  className,
}: TaskDependencyGraphProps) {
  const taskMap = React.useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) {
      map.set(task.id, task);
    }
    return map;
  }, [tasks]);

  // Find root tasks (tasks with no blockedBy)
  const rootTasks = React.useMemo(() => {
    return tasks.filter((t) => t.blockedBy.length === 0);
  }, [tasks]);

  // Find all orphan tasks (tasks that nothing depends on and they don't depend on anything)
  const orphanTasks = React.useMemo(() => {
    const blockingIds = new Set<string>();
    for (const task of tasks) {
      for (const depId of task.blockedBy) {
        blockingIds.add(depId);
      }
    }
    return tasks.filter(
      (t) =>
        t.blockedBy.length === 0 &&
        t.blocks.length === 0 &&
        !blockingIds.has(t.id)
    );
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground p-4", className)}>
        No tasks to display
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Independent tasks */}
      {orphanTasks.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            Independent Tasks
          </h4>
          <div className="space-y-1">
            {orphanTasks.map((task) => (
              <TaskTreeItem
                key={task.id}
                task={task}
                onClick={() => onTaskClick?.(task)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tasks with dependencies */}
      {rootTasks
        .filter((t) => t.blocks.length > 0)
        .map((task) => (
          <div key={task.id}>
            <h4 className="text-sm font-medium mb-2">Dependency Chain</h4>
            <TaskDependencyTree
              tasks={tasks}
              rootTaskId={task.id}
              onTaskClick={onTaskClick}
            />
          </div>
        ))}
    </div>
  );
}

/**
 * TaskDependencySelector - Select dependencies when creating/editing a task
 */
export interface TaskDependencySelectorProps {
  tasks: Task[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];
  className?: string;
}

export function TaskDependencySelector({
  tasks,
  selectedIds,
  onChange,
  excludeIds = [],
  className,
}: TaskDependencySelectorProps) {
  // Filter tasks that can be selected (exclude self and descendants to avoid circular deps)
  const availableTasks = React.useMemo(() => {
    const excludeSet = new Set(excludeIds);

    // Also exclude descendants
    const collectDescendants = (taskId: string): Set<string> => {
      const descendants = new Set<string>();
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        for (const blockId of task.blocks) {
          if (!excludeSet.has(blockId)) {
            descendants.add(blockId);
            const subDescendants = collectDescendants(blockId);
            subDescendants.forEach((d) => descendants.add(d));
          }
        }
      }
      return descendants;
    };

    for (const excludeId of excludeIds) {
      const descendants = collectDescendants(excludeId);
      descendants.forEach((d) => excludeSet.add(d));
    }

    return tasks.filter((t) => !excludeSet.has(t.id));
  }, [tasks, excludeIds]);

  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-sm font-medium">Dependencies</label>
      <div className="border rounded-lg p-2 space-y-1 max-h-64 overflow-y-auto">
        {availableTasks.map((task) => (
          <label
            key={task.id}
            className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(task.id)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange([...selectedIds, task.id]);
                } else {
                  onChange(selectedIds.filter((id) => id !== task.id));
                }
              }}
              className="rounded"
            />
            <span className="text-lg">{STATUS_CONFIG[task.status].icon}</span>
            <span className="text-sm truncate flex-1">{task.subject}</span>
            <span className="text-xs text-muted-foreground">#{task.id}</span>
          </label>
        ))}
      </div>
      {selectedIds.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Selected: {selectedIds.join(", ")}
        </div>
      )}
    </div>
  );
}
