"use client";

import { cn } from "@/lib/utils";
import {
  ClockIcon,
  PlayIcon,
  PauseIcon,
  TrashIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface CronResultProps {
  output: string | Record<string, unknown>;
  input?: Record<string, unknown>;
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt?: string;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string;
}

interface CronExecution {
  status: string;
  triggeredAt: string;
  duration?: string | null;
  error?: string;
}

function parseCronOutput(
  output: string | Record<string, unknown>
): {
  success: boolean;
  message?: string;
  job?: CronJob;
  jobs?: CronJob[];
  total?: number;
  recentExecutions?: CronExecution[];
  error?: string;
} | null {
  try {
    const data = typeof output === "string" ? JSON.parse(output) : output;
    return {
      success: (data.success as boolean) ?? false,
      message: data.message as string | undefined,
      job: data.job as CronJob | undefined,
      jobs: data.jobs as CronJob[] | undefined,
      total: data.total as number | undefined,
      recentExecutions: data.recentExecutions as CronExecution[] | undefined,
      error: data.error as string | undefined,
    };
  } catch {
    return null;
  }
}

// Human-readable schedule
function formatSchedule(schedule: string): string {
  // Simple cron descriptions
  const descriptions: Record<string, string> = {
    "* * * * *": "Every minute",
    "0 * * * *": "Every hour",
    "0 0 * * *": "Every day at midnight",
    "0 9 * * *": "Every day at 9:00",
    "0 9 * * 1": "Every Monday at 9:00",
    "0 9 * * 1-5": "Weekdays at 9:00",
    "0 0 * * 0": "Every Sunday at midnight",
  };
  return descriptions[schedule] ?? schedule;
}

// ============================================================
// Components
// ============================================================

function JobItem({ job }: { job: CronJob }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3">
      {/* Status indicator */}
      <div className={cn(
        "size-2 rounded-full shrink-0",
        job.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
      )} />

      {/* Job info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{job.name}</span>
          {!job.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              disabled
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <ClockIcon className="size-3" />
          <span className="font-mono">{formatSchedule(job.schedule)}</span>
        </div>
      </div>

      {/* Next run */}
      {job.nextRunAt && (
        <div className="text-right shrink-0">
          <div className="text-[10px] text-muted-foreground/60">next</div>
          <div className="text-xs text-muted-foreground">{job.nextRunAt}</div>
        </div>
      )}
    </div>
  );
}

function ExecutionItem({ execution }: { execution: CronExecution }) {
  const isSuccess = execution.status === "success";
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 text-xs">
      {isSuccess ? (
        <CheckCircleIcon className="size-3.5 text-emerald-500" />
      ) : (
        <XCircleIcon className="size-3.5 text-destructive" />
      )}
      <span className="text-muted-foreground">{execution.triggeredAt}</span>
      {execution.duration && (
        <span className="text-muted-foreground/60">({execution.duration})</span>
      )}
      {execution.error && (
        <span className="text-destructive truncate max-w-[200px]">{execution.error}</span>
      )}
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function CronResult({ output, input, className }: CronResultProps) {
  const data = parseCronOutput(output);

  if (!data) {
    return (
      <div className={cn("text-xs text-muted-foreground font-mono", className)}>
        {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
      </div>
    );
  }

  // Error state
  if (data.error) {
    return (
      <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  // Single job detail (get action)
  if (data.job && data.recentExecutions) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center gap-2 text-xs">
          <ClockIcon className="size-4 text-blue-500" />
          <span className="font-medium text-foreground">{data.job.name}</span>
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[10px]",
            data.job.enabled
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          )}>
            {data.job.enabled ? "enabled" : "disabled"}
          </span>
        </div>

        <div className="rounded-md border bg-card divide-y divide-border/50">
          <div className="px-3 py-2 text-xs">
            <span className="text-muted-foreground">Schedule:</span>{" "}
            <span className="font-mono text-foreground">{data.job.schedule}</span>
          </div>
          {data.job.prompt && (
            <div className="px-3 py-2 text-xs">
              <span className="text-muted-foreground">Prompt:</span>{" "}
              <span className="text-foreground">{data.job.prompt}</span>
            </div>
          )}
        </div>

        {/* Recent executions */}
        {data.recentExecutions.length > 0 && (
          <div className="rounded-md border bg-card overflow-hidden">
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b">
              Recent Executions
            </div>
            <div className="divide-y divide-border/50">
              {data.recentExecutions.map((exec, i) => (
                <ExecutionItem key={i} execution={exec} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Job list (list action)
  if (data.jobs) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ClockIcon className="size-3.5" />
          <span>
            <span className="font-medium text-foreground">{data.total ?? data.jobs.length}</span> cron job{(data.total ?? data.jobs.length) !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="rounded-md border bg-card overflow-hidden divide-y divide-border/50">
          {data.jobs.map((job) => (
            <JobItem key={job.id} job={job} />
          ))}
        </div>
      </div>
    );
  }

  // Simple message (create/update/delete/enable/disable)
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-xs">
        <CheckCircleIcon className="size-4 text-emerald-500" />
        <span className="text-foreground">{data.message}</span>
      </div>
    </div>
  );
}
