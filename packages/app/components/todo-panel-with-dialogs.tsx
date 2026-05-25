"use client";

/**
 * TodoPanelWithDialogs - Todo panel with integrated dialogs
 * 
 * Combines TodoPanel with TodoDialogs for a complete todo management UI.
 */

import * as React from "react";
import type { Todo } from "@/lib/todos/types";
import { TodoPanel, TodoPanelProps } from "./todo-panel";
import {
  ClaimTodoDialog,
  CompleteTodoDialog,
  StopTodoDialog,
  DeleteTodoDialog,
  TodoDetailsDialog,
} from "./todo-dialogs";

/**
 * Dialog state type
 */
type DialogType =
  | { type: "claim"; todoId: string; subject: string }
  | { type: "complete"; todoId: string; subject: string }
  | { type: "stop"; todoId: string; subject: string }
  | { type: "delete"; todoId: string; subject: string }
  | { type: "details"; todo: Todo }
  | null;

/**
 * TodoPanelWithDialogs Props
 */
export interface TodoPanelWithDialogsProps
  extends Omit<TodoPanelProps, "onClaim" | "onComplete" | "onStop" | "onDelete" | "onRetry"> {
  /** Claim a todo (async) */
  onClaim: (todoId: string) => Promise<void>;
  /** Complete a todo with result (async) */
  onComplete: (todoId: string, result: string) => Promise<void>;
  /** Stop a todo with reason (async) */
  onStop: (todoId: string, reason: string) => Promise<void>;
  /** Delete a todo (async) */
  onDelete: (todoId: string) => Promise<void>;
  /** Retry a failed/cancelled todo (async) */
  onRetry?: (todoId: string) => Promise<void>;
}

/**
 * TodoPanelWithDialogs component
 * 
 * Provides a complete todo management interface with:
 * - Todo list grouped by status
 * - Confirmation dialogs for dangerous actions
 * - Todo details view
 */
export function TodoPanelWithDialogs({
  todos,
  onClaim,
  onComplete,
  onStop,
  onDelete,
  onRetry,
  className,
}: TodoPanelWithDialogsProps) {
  const [dialog, setDialog] = React.useState<DialogType>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);

  // Handlers for opening dialogs
  const handleClaim = (todoId: string) => {
    const todo = todos.find((t) => t.id === todoId);
    if (todo) {
      setDialog({ type: "claim", todoId, subject: todo.subject });
    }
  };

  const handleComplete = (todoId: string) => {
    const todo = todos.find((t) => t.id === todoId);
    if (todo) {
      setDialog({ type: "complete", todoId, subject: todo.subject });
    }
  };

  const handleStop = (todoId: string) => {
    const todo = todos.find((t) => t.id === todoId);
    if (todo) {
      setDialog({ type: "stop", todoId, subject: todo.subject });
    }
  };

  const handleDelete = (todoId: string) => {
    const todo = todos.find((t) => t.id === todoId);
    if (todo) {
      setDialog({ type: "delete", todoId, subject: todo.subject });
    }
  };

  const handleRetry = (todoId: string) => {
    if (onRetry) {
      onRetry(todoId);
    }
  };

  const handleTodoClick = (todo: Todo) => {
    setDialog({ type: "details", todo });
  };

  // Close dialog
  const closeDialog = () => setDialog(null);

  // Process dialog confirmations
  const processClaim = async () => {
    if (dialog?.type !== "claim") return;
    setIsProcessing(true);
    try {
      await onClaim(dialog.todoId);
      closeDialog();
    } finally {
      setIsProcessing(false);
    }
  };

  const processComplete = async (result: string) => {
    if (dialog?.type !== "complete") return;
    setIsProcessing(true);
    try {
      await onComplete(dialog.todoId, result);
      closeDialog();
    } finally {
      setIsProcessing(false);
    }
  };

  const processStop = async (reason: string) => {
    if (dialog?.type !== "stop") return;
    setIsProcessing(true);
    try {
      await onStop(dialog.todoId, reason);
      closeDialog();
    } finally {
      setIsProcessing(false);
    }
  };

  const processDelete = async () => {
    if (dialog?.type !== "delete") return;
    setIsProcessing(true);
    try {
      await onDelete(dialog.todoId);
      closeDialog();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <TodoPanel
        todos={todos}
        onClaim={handleClaim}
        onComplete={handleComplete}
        onStop={handleStop}
        onDelete={handleDelete}
        onRetry={handleRetry}
        onTodoClick={handleTodoClick}
        className={className}
      />

      {/* Claim Dialog */}
      {dialog?.type === "claim" && (
        <ClaimTodoDialog
          todoId={dialog.todoId}
          subject={dialog.subject}
          open={true}
          onConfirm={processClaim}
          onCancel={closeDialog}
        />
      )}

      {/* Complete Dialog */}
      {dialog?.type === "complete" && (
        <CompleteTodoDialog
          todoId={dialog.todoId}
          subject={dialog.subject}
          open={true}
          onConfirm={processComplete}
          onCancel={closeDialog}
        />
      )}

      {/* Stop Dialog */}
      {dialog?.type === "stop" && (
        <StopTodoDialog
          todoId={dialog.todoId}
          subject={dialog.subject}
          open={true}
          onConfirm={processStop}
          onCancel={closeDialog}
        />
      )}

      {/* Delete Dialog */}
      {dialog?.type === "delete" && (
        <DeleteTodoDialog
          todoId={dialog.todoId}
          subject={dialog.subject}
          open={true}
          onConfirm={processDelete}
          onCancel={closeDialog}
        />
      )}

      {/* Todo Details Dialog */}
      {dialog?.type === "details" && (
        <TodoDetailsDialog
          todo={dialog.todo}
          open={true}
          onClose={closeDialog}
          onClaim={() => {
            const todo = dialog.todo;
            if (todo) {
              closeDialog();
              // Small delay to ensure dialog is closed
              setTimeout(() => handleClaim(todo.id), 100);
            }
          }}
          onComplete={() => {
            const todo = dialog.todo;
            if (todo) {
              closeDialog();
              setTimeout(() => handleComplete(todo.id), 100);
            }
          }}
          onStop={() => {
            const todo = dialog.todo;
            if (todo) {
              closeDialog();
              setTimeout(() => handleStop(todo.id), 100);
            }
          }}
          onDelete={() => {
            const todo = dialog.todo;
            if (todo) {
              closeDialog();
              setTimeout(() => handleDelete(todo.id), 100);
            }
          }}
          onRetry={
            onRetry
              ? () => {
                  const todo = dialog.todo;
                  if (todo) {
                    closeDialog();
                    setTimeout(() => handleRetry(todo.id), 100);
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
 * TodoPanelWithStore - TodoPanelWithDialogs bound to a TodoStore
 * 
 * Provides a simpler interface when working directly with a TodoStore.
 */
export interface TodoPanelWithStoreProps {
  /** Todo store */
  store: {
    getAllTodos: () => Todo[];
    claimTodo: (todoId: string, agentId: string) => { success: boolean; message?: string };
    updateTodo: (input: { id: string; status?: string; metadata?: Record<string, unknown> }) => Todo | undefined;
    deleteTodo: (id: string) => boolean;
  };
  /** Agent ID performing actions */
  agentId: string;
  /** Called when todos change */
  onTodosChange?: (todos: Todo[]) => void;
  className?: string;
}

export function TodoPanelWithStore({
  store,
  agentId,
  onTodosChange,
  className,
}: TodoPanelWithStoreProps) {
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const todosRef = React.useRef<string>('');
  const onTodosChangeRef = React.useRef(onTodosChange);
  onTodosChangeRef.current = onTodosChange;

  // Load todos
  React.useEffect(() => {
    const initial = store.getAllTodos();
    todosRef.current = JSON.stringify(initial);
    setTodos(initial);
  }, [store]);

  // Subscribe to todo store changes
  React.useEffect(() => {
    const interval = setInterval(() => {
      const newTodos = store.getAllTodos();
      const serialized = JSON.stringify(newTodos);
      if (serialized !== todosRef.current) {
        todosRef.current = serialized;
        setTodos(newTodos);
        onTodosChangeRef.current?.(newTodos);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [store]);

  const handleClaim = async (todoId: string) => {
    const result = store.claimTodo(todoId, agentId);
    if (!result.success) {
      console.error("Claim failed:", result.message);
    }
    setTodos(store.getAllTodos());
  };

  const handleComplete = async (todoId: string, result: string) => {
    store.updateTodo({
      id: todoId,
      status: "completed",
      metadata: { result },
    });
    setTodos(store.getAllTodos());
  };

  const handleStop = async (todoId: string, reason: string) => {
    store.updateTodo({
      id: todoId,
      status: "cancelled",
      metadata: { stopReason: reason },
    });
    setTodos(store.getAllTodos());
  };

  const handleDelete = async (todoId: string) => {
    store.deleteTodo(todoId);
    setTodos(store.getAllTodos());
  };

  return (
    <TodoPanelWithDialogs
      todos={todos}
      onClaim={handleClaim}
      onComplete={handleComplete}
      onStop={handleStop}
      onDelete={handleDelete}
      className={className}
    />
  );
}
