"use client";

/**
 * TaskPanelWithDialogs - Task panel with integrated dialogs
 * 
 * Combines TaskPanel with TaskDialogs for a complete task management UI.
 */

import * as React from "react";
import type { Task } from "@/lib/tasks/types";
import { TaskPanel, TaskPanelProps } from "./task-panel";
import {
  ClaimTaskDialog,
  CompleteTaskDialog,
  StopTaskDialog,
  DeleteTaskDialog,
  TaskDetailsDialog,
} from "./task-dialogs";

/**
 * Dialog state type
 */
type DialogType =
  | { type: "claim"; taskId: string; subject: string }
  | { type: "complete"; taskId: string; subject: string }
  | { type: "stop"; taskId: string; subject: string }
  | { type: "delete"; taskId: string; subject: string }
  | { type: "details"; task: Task }
  | null;

/**
 * TaskPanelWithDialogs Props
 */
export interface TaskPanelWithDialogsProps
  extends Omit<TaskPanelProps, "onClaim" | "onComplete" | "onStop" | "onDelete" | "onRetry"> {
  /** Claim a task (async) */
  onClaim: (taskId: string) => Promise<void>;
  /** Complete a task with result (async) */
  onComplete: (taskId: string, result: string) => Promise<void>;
  /** Stop a task with reason (async) */
  onStop: (taskId: string, reason: string) => Promise<void>;
  /** Delete a task (async) */
  onDelete: (taskId: string) => Promise<void>;
  /** Retry a failed/cancelled task (async) */
  onRetry?: (taskId: string) => Promise<void>;
}

/**
 * TaskPanelWithDialogs component
 * 
 * Provides a complete task management interface with:
 * - Task list grouped by status
 * - Confirmation dialogs for dangerous actions
 * - Task details view
 */
export function TaskPanelWithDialogs({
  tasks,
  onClaim,
  onComplete,
  onStop,
  onDelete,
  onRetry,
  className,
}: TaskPanelWithDialogsProps) {
  const [dialog, setDialog] = React.useState<DialogType>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);

  // Handlers for opening dialogs
  const handleClaim = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setDialog({ type: "claim", taskId, subject: task.subject });
    }
  };

  const handleComplete = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setDialog({ type: "complete", taskId, subject: task.subject });
    }
  };

  const handleStop = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setDialog({ type: "stop", taskId, subject: task.subject });
    }
  };

  const handleDelete = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setDialog({ type: "delete", taskId, subject: task.subject });
    }
  };

  const handleRetry = (taskId: string) => {
    if (onRetry) {
      onRetry(taskId);
    }
  };

  const handleTaskClick = (task: Task) => {
    setDialog({ type: "details", task });
  };

  // Close dialog
  const closeDialog = () => setDialog(null);

  // Process dialog confirmations
  const processClaim = async () => {
    if (dialog?.type !== "claim") return;
    setIsProcessing(true);
    try {
      await onClaim(dialog.taskId);
      closeDialog();
    } finally {
      setIsProcessing(false);
    }
  };

  const processComplete = async (result: string) => {
    if (dialog?.type !== "complete") return;
    setIsProcessing(true);
    try {
      await onComplete(dialog.taskId, result);
      closeDialog();
    } finally {
      setIsProcessing(false);
    }
  };

  const processStop = async (reason: string) => {
    if (dialog?.type !== "stop") return;
    setIsProcessing(true);
    try {
      await onStop(dialog.taskId, reason);
      closeDialog();
    } finally {
      setIsProcessing(false);
    }
  };

  const processDelete = async () => {
    if (dialog?.type !== "delete") return;
    setIsProcessing(true);
    try {
      await onDelete(dialog.taskId);
      closeDialog();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <TaskPanel
        tasks={tasks}
        onClaim={handleClaim}
        onComplete={handleComplete}
        onStop={handleStop}
        onDelete={handleDelete}
        onRetry={handleRetry}
        onTaskClick={handleTaskClick}
        className={className}
      />

      {/* Claim Dialog */}
      {dialog?.type === "claim" && (
        <ClaimTaskDialog
          taskId={dialog.taskId}
          subject={dialog.subject}
          open={true}
          onConfirm={processClaim}
          onCancel={closeDialog}
        />
      )}

      {/* Complete Dialog */}
      {dialog?.type === "complete" && (
        <CompleteTaskDialog
          taskId={dialog.taskId}
          subject={dialog.subject}
          open={true}
          onConfirm={processComplete}
          onCancel={closeDialog}
        />
      )}

      {/* Stop Dialog */}
      {dialog?.type === "stop" && (
        <StopTaskDialog
          taskId={dialog.taskId}
          subject={dialog.subject}
          open={true}
          onConfirm={processStop}
          onCancel={closeDialog}
        />
      )}

      {/* Delete Dialog */}
      {dialog?.type === "delete" && (
        <DeleteTaskDialog
          taskId={dialog.taskId}
          subject={dialog.subject}
          open={true}
          onConfirm={processDelete}
          onCancel={closeDialog}
        />
      )}

      {/* Task Details Dialog */}
      {dialog?.type === "details" && (
        <TaskDetailsDialog
          task={dialog.task}
          open={true}
          onClose={closeDialog}
          onClaim={() => {
            const task = dialog.task;
            if (task) {
              closeDialog();
              // Small delay to ensure dialog is closed
              setTimeout(() => handleClaim(task.id), 100);
            }
          }}
          onComplete={() => {
            const task = dialog.task;
            if (task) {
              closeDialog();
              setTimeout(() => handleComplete(task.id), 100);
            }
          }}
          onStop={() => {
            const task = dialog.task;
            if (task) {
              closeDialog();
              setTimeout(() => handleStop(task.id), 100);
            }
          }}
          onDelete={() => {
            const task = dialog.task;
            if (task) {
              closeDialog();
              setTimeout(() => handleDelete(task.id), 100);
            }
          }}
          onRetry={
            onRetry
              ? () => {
                  const task = dialog.task;
                  if (task) {
                    closeDialog();
                    setTimeout(() => handleRetry(task.id), 100);
                  }
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/**
 * TaskPanelWithStore - TaskPanelWithDialogs bound to a TaskStore
 * 
 * Provides a simpler interface when working directly with a TaskStore.
 */
export interface TaskPanelWithStoreProps {
  /** Task store */
  store: {
    getAllTasks: () => Task[];
    claimTask: (taskId: string, agentId: string) => { success: boolean; message?: string };
    updateTask: (input: { id: string; status?: string; metadata?: Record<string, unknown> }) => Task | undefined;
    deleteTask: (id: string) => boolean;
  };
  /** Agent ID performing actions */
  agentId: string;
  /** Called when tasks change */
  onTasksChange?: (tasks: Task[]) => void;
  className?: string;
}

export function TaskPanelWithStore({
  store,
  agentId,
  onTasksChange,
  className,
}: TaskPanelWithStoreProps) {
  const [tasks, setTasks] = React.useState<Task[]>([]);

  // Load tasks
  React.useEffect(() => {
    setTasks(store.getAllTasks());
  }, [store]);

  // Subscribe to task store changes
  React.useEffect(() => {
    const interval = setInterval(() => {
      const newTasks = store.getAllTasks();
      if (JSON.stringify(newTasks) !== JSON.stringify(tasks)) {
        setTasks(newTasks);
        onTasksChange?.(newTasks);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [store, tasks, onTasksChange]);

  const handleClaim = async (taskId: string) => {
    const result = store.claimTask(taskId, agentId);
    if (!result.success) {
      console.error("Claim failed:", result.message);
    }
    setTasks(store.getAllTasks());
  };

  const handleComplete = async (taskId: string, result: string) => {
    store.updateTask({
      id: taskId,
      status: "completed",
      metadata: { result },
    });
    setTasks(store.getAllTasks());
  };

  const handleStop = async (taskId: string, reason: string) => {
    store.updateTask({
      id: taskId,
      status: "cancelled",
      metadata: { stopReason: reason },
    });
    setTasks(store.getAllTasks());
  };

  const handleDelete = async (taskId: string) => {
    store.deleteTask(taskId);
    setTasks(store.getAllTasks());
  };

  return (
    <TaskPanelWithDialogs
      tasks={tasks}
      onClaim={handleClaim}
      onComplete={handleComplete}
      onStop={handleStop}
      onDelete={handleDelete}
      className={className}
    />
  );
}
