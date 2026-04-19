"use client";

/**
 * TaskDialogs - Dialog components for task operations
 * 
 * Provides confirmation dialogs for:
 * - Claiming a task
 * - Completing a task (with result summary)
 * - Stopping a task (with reason)
 * - Deleting a task
 */

import * as React from "react";
import type { Task } from "@/lib/tasks/types";
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
 * Claim Task Dialog
 */
export interface ClaimTaskDialogProps {
  taskId: string;
  subject: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ClaimTaskDialog({
  taskId,
  subject,
  open,
  onConfirm,
  onCancel,
}: ClaimTaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim Task #{taskId}</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to claim this task? You will be responsible for
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
 * Complete Task Dialog
 */
export interface CompleteTaskDialogProps {
  taskId: string;
  subject: string;
  open: boolean;
  onConfirm: (result: string) => void;
  onCancel: () => void;
}

export function CompleteTaskDialog({
  taskId,
  subject,
  open,
  onConfirm,
  onCancel,
}: CompleteTaskDialogProps) {
  const [result, setResult] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete Task</DialogTitle>
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
 * Stop Task Dialog
 */
export interface StopTaskDialogProps {
  taskId: string;
  subject: string;
  open: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function StopTaskDialog({
  taskId,
  subject,
  open,
  onConfirm,
  onCancel,
}: StopTaskDialogProps) {
  const [reason, setReason] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop Task</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Reason (optional)</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this task being stopped?"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)}>
            Stop Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete Task Dialog
 */
export interface DeleteTaskDialogProps {
  taskId: string;
  subject: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteTaskDialog({
  taskId,
  subject,
  open,
  onCancel,
  onConfirm,
}: DeleteTaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Task</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete this task? This action cannot be undone.
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
 * Task Details Dialog - Shows full task information
 */
export interface TaskDetailsDialogProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onClaim?: () => void;
  onComplete?: () => void;
  onStop?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
}

export function TaskDetailsDialog({
  task,
  open,
  onClose,
  onClaim,
  onComplete,
  onStop,
  onDelete,
  onRetry,
}: TaskDetailsDialogProps) {
  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{STATUS_CONFIG[task.status].icon}</span>
            {task.subject}
          </DialogTitle>
          <DialogDescription>Task #{task.id}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status:</span>
            <span className={STATUS_CONFIG[task.status].color}>
              {task.status.replace("_", " ")}
            </span>
          </div>

          {/* Claimed By */}
          {task.claimedBy && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Claimed By:</span>
              <span className="text-sm">{task.claimedBy}</span>
            </div>
          )}

          {/* Active Form */}
          {task.activeForm && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Current Activity:</span>
              <p className="text-sm bg-blue-50 dark:bg-blue-950/30 p-2 rounded">
                {task.activeForm}
              </p>
            </div>
          )}

          {/* Dependencies */}
          {task.blockedBy.length > 0 && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Blocked By:</span>
              <div className="flex flex-wrap gap-2">
                {task.blockedBy.map((id) => (
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
          {task.blocks.length > 0 && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Blocks:</span>
              <div className="flex flex-wrap gap-2">
                {task.blocks.map((id) => (
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
          {task.metadata?.error && (
            <div className="space-y-1">
              <span className="text-sm font-medium text-red-600">Error:</span>
              <p className="text-sm bg-red-50 dark:bg-red-950/30 p-2 rounded text-red-700 dark:text-red-400">
                {task.metadata.error as string}
              </p>
            </div>
          )}

          {/* Result */}
          {task.metadata?.result && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Result:</span>
              <p className="text-sm bg-green-50 dark:bg-green-950/30 p-2 rounded">
                {task.metadata.result as string}
              </p>
            </div>
          )}

          {/* Stop Reason */}
          {task.metadata?.stopReason && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Stop Reason:</span>
              <p className="text-sm bg-gray-50 dark:bg-gray-800 p-2 rounded">
                {task.metadata.stopReason as string}
              </p>
            </div>
          )}

          {/* Metadata */}
          {(task.metadata?.priority || task.metadata?.tags) && (
            <div className="flex gap-2">
              {task.metadata?.priority && (
                <PriorityBadgeInline
                  priority={task.metadata.priority as "low" | "medium" | "high"}
                />
              )}
              {(task.metadata?.tags as string[])?.map((tag) => (
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
            <p>Created: {new Date(task.createdAt).toLocaleString()}</p>
            <p>Updated: {new Date(task.updatedAt).toLocaleString()}</p>
            {task.completedAt && (
              <p>Completed: {new Date(task.completedAt).toLocaleString()}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <DialogFooter className="flex-wrap gap-2">
          {task.status === "pending" && onClaim && (
            <Button onClick={onClaim}>Claim</Button>
          )}
          {task.status === "in_progress" && onComplete && (
            <Button onClick={onComplete}>Complete</Button>
          )}
          {task.status === "in_progress" && onStop && (
            <Button variant="destructive" onClick={onStop}>
              Stop
            </Button>
          )}
          {(task.status === "failed" || task.status === "cancelled") && onRetry && (
            <Button onClick={onRetry}>Retry</Button>
          )}
          {task.status !== "in_progress" && onDelete && (
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
import { STATUS_CONFIG } from "@/lib/tasks/types";
