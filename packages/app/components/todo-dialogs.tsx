"use client";

/**
 * TodoDialogs - Dialog components for todo operations
 * 
 * Provides confirmation dialogs for:
 * - Claiming a todo
 * - Completing a todo (with result summary)
 * - Stopping a todo (with reason)
 * - Deleting a todo
 */

import * as React from "react";
import type { Todo } from "@/lib/todos/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Claim Todo Dialog
 */
export interface ClaimTodoDialogProps {
  todoId: string;
  subject: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ClaimTodoDialog({
  todoId,
  subject,
  open,
  onConfirm,
  onCancel,
}: ClaimTodoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim Todo #{todoId}</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to claim this todo? You will be responsible for
          completing it.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Claim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Complete Todo Dialog
 */
export interface CompleteTodoDialogProps {
  todoId: string;
  subject: string;
  open: boolean;
  onConfirm: (result: string) => void;
  onCancel: () => void;
}

export function CompleteTodoDialog({
  todoId,
  subject,
  open,
  onConfirm,
  onCancel,
}: CompleteTodoDialogProps) {
  const [result, setResult] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete Todo</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Result Summary</label>
          <Textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            placeholder="Brief summary of what was accomplished..."
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(result)}>Complete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Stop Todo Dialog
 */
export interface StopTodoDialogProps {
  todoId: string;
  subject: string;
  open: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function StopTodoDialog({
  todoId,
  subject,
  open,
  onConfirm,
  onCancel,
}: StopTodoDialogProps) {
  const [reason, setReason] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop Todo</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Reason (optional)</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this todo being stopped?"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)}>
            Stop Todo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete Todo Dialog
 */
export interface DeleteTodoDialogProps {
  todoId: string;
  subject: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteTodoDialog({
  todoId,
  subject,
  open,
  onCancel,
  onConfirm,
}: DeleteTodoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Todo</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete this todo? This action cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Todo Details Dialog - Shows full todo information
 */
export interface TodoDetailsDialogProps {
  todo: Todo | null;
  open: boolean;
  onClose: () => void;
  onClaim?: () => void;
  onComplete?: () => void;
  onStop?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
}

export function TodoDetailsDialog({
  todo,
  open,
  onClose,
  onClaim,
  onComplete,
  onStop,
  onDelete,
  onRetry,
}: TodoDetailsDialogProps) {
  if (!todo) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{STATUS_CONFIG[todo.status].icon}</span>
            {todo.subject}
          </DialogTitle>
          <DialogDescription>Todo #{todo.id}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status:</span>
            <span className={STATUS_STYLES[todo.status].color}>
              {todo.status.replace("_", " ")}
            </span>
          </div>

          {/* Claimed By */}
          {todo.claimedBy && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Claimed By:</span>
              <span className="text-sm">{todo.claimedBy}</span>
            </div>
          )}

          {/* Active Form */}
          {todo.activeForm && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Current Activity:</span>
              <p className="text-sm bg-blue-50 dark:bg-blue-950/30 p-2 rounded">
                {todo.activeForm}
              </p>
            </div>
          )}

          {/* Dependencies */}
          {todo.blockedBy.length > 0 && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Blocked By:</span>
              <div className="flex flex-wrap gap-2">
                {todo.blockedBy.map((id) => (
                  <span
                    key={id}
                    className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Blocks */}
          {todo.blocks.length > 0 && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Blocks:</span>
              <div className="flex flex-wrap gap-2">
                {todo.blocks.map((id) => (
                  <span
                    key={id}
                    className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-1 rounded"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {todo.metadata?.error && (
            <div className="space-y-1">
              <span className="text-sm font-medium text-red-600">Error:</span>
              <p className="text-sm bg-red-50 dark:bg-red-950/30 p-2 rounded text-red-700 dark:text-red-400">
                {todo.metadata.error as string}
              </p>
            </div>
          )}

          {/* Result */}
          {todo.metadata?.result && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Result:</span>
              <p className="text-sm bg-green-50 dark:bg-green-950/30 p-2 rounded">
                {todo.metadata.result as string}
              </p>
            </div>
          )}

          {/* Stop Reason */}
          {todo.metadata?.stopReason && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Stop Reason:</span>
              <p className="text-sm bg-gray-50 dark:bg-gray-800 p-2 rounded">
                {todo.metadata.stopReason as string}
              </p>
            </div>
          )}

          {/* Metadata */}
          {(todo.metadata?.priority || todo.metadata?.tags) && (
            <div className="flex gap-2">
              {todo.metadata?.priority && (
                <PriorityBadgeInline
                  priority={todo.metadata.priority as "low" | "medium" | "high"}
                />
              )}
              {(todo.metadata?.tags as string[])?.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-1 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Timestamps */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Created: {new Date(todo.createdAt).toLocaleString()}</p>
            <p>Updated: {new Date(todo.updatedAt).toLocaleString()}</p>
            {todo.completedAt && (
              <p>Completed: {new Date(todo.completedAt).toLocaleString()}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <DialogFooter className="flex-wrap gap-2">
          {todo.status === "pending" && onClaim && (
            <Button onClick={onClaim}>Claim</Button>
          )}
          {todo.status === "in_progress" && onComplete && (
            <Button onClick={onComplete}>Complete</Button>
          )}
          {todo.status === "in_progress" && onStop && (
            <Button variant="destructive" onClick={onStop}>
              Stop
            </Button>
          )}
          {(todo.status === "failed" || todo.status === "cancelled") && onRetry && (
            <Button onClick={onRetry}>Retry</Button>
          )}
          {todo.status !== "in_progress" && onDelete && (
            <Button variant="outline" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriorityBadgeInline({ priority }: { priority: "low" | "medium" | "high" }) {
  const colors = {
    low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-500",
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-500",
  };

  return (
    <span className={`text-xs px-2 py-1 rounded ${colors[priority]}`}>
      {priority}
    </span>
  );
}

// Re-export status config for convenience
import { STATUS_CONFIG, STATUS_STYLES } from "@/lib/todos/types";
