'use client'

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  RefreshCwIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  UserIcon,
  BotIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface CronJob {
  id: string
  name: string
  schedule: string
  prompt: string
  agentType?: string
  enabled: boolean
  lastRunAt: number | null
  nextRunAt: number
}

interface ExecutionMessage {
  id: string
  role: string
  text: string
}

interface CronExecution {
  id: string
  jobId: string
  status: 'triggered' | 'completed' | 'failed'
  triggeredAt: number
  completedAt: number | null
  duration: number | null
  conversationId: string | null
  error: string | null
  eventId: string | null
  messages?: ExecutionMessage[]
}

export default function AutomationExecutions({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<CronJob | null>(null)
  const [executions, setExecutions] = useState<CronExecution[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/cron/${jobId}?messages=true&limit=50`)
      if (res.ok) {
        const data = await res.json()
        setJob(data.job)
        setExecutions(data.executions ?? [])
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [jobId])

  useEffect(() => { loadData() }, [loadData])

  const toggleExpand = (execId: string) => {
    setExpandedId(prev => prev === execId ? null : execId)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        加载中...
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
        <p className="text-sm">任务不存在</p>
        <Link href="/settings/automation" className="text-sm text-primary hover:underline">
          返回任务列表
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <Link
          href="/settings/automation"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-4" />
          返回
        </Link>
        <div className="h-4 w-px bg-border" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{job.name}</span>
            <Badge variant={job.enabled ? "default" : "secondary"} className="text-xs shrink-0">
              {job.enabled ? "已启用" : "已禁用"}
            </Badge>
          </div>
          <code className="text-xs text-muted-foreground/70 font-mono">{job.schedule}</code>
        </div>
        <Button variant="ghost" size="sm" onClick={loadData} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Execution list */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
        {executions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <ClockIcon className="size-8 opacity-30" />
            <p className="text-sm">暂无执行记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {executions.map(exec => (
              <div key={exec.id} className="rounded-lg border overflow-hidden">
                {/* Execution summary */}
                <button
                  type="button"
                  onClick={() => toggleExpand(exec.id)}
                  className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  {exec.status === 'completed' && (
                    <CheckCircleIcon className="size-4 text-green-500 shrink-0" />
                  )}
                  {exec.status === 'failed' && (
                    <XCircleIcon className="size-4 text-destructive shrink-0" />
                  )}
                  {exec.status === 'triggered' && (
                    <ClockIcon className="size-4 text-muted-foreground shrink-0" />
                  )}

                  <span className="text-sm">
                    {new Date(exec.triggeredAt).toLocaleString()}
                  </span>

                  {exec.duration != null && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {exec.duration < 1000 ? `${exec.duration}ms` : `${(exec.duration / 1000).toFixed(1)}s`}
                    </span>
                  )}

                  {exec.error && (
                    <span className="text-xs text-destructive truncate max-w-[200px]">{exec.error}</span>
                  )}

                  <div className="ml-auto shrink-0">
                    {expandedId === exec.id
                      ? <ChevronDownIcon className="size-4 text-muted-foreground" />
                      : <ChevronRightIcon className="size-4 text-muted-foreground" />
                    }
                  </div>
                </button>

                {/* Message thread */}
                {expandedId === exec.id && exec.messages && exec.messages.length > 0 && (
                  <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
                    {exec.messages.map(msg => (
                      <div
                        key={msg.id}
                        className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role !== 'user' && (
                          <div className="shrink-0 mt-0.5">
                            <BotIcon className="size-4 text-muted-foreground" />
                          </div>
                        )}
                        <div
                          className={`rounded-lg px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap ${
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background border'
                          }`}
                        >
                          {msg.text || <span className="text-muted-foreground italic">（空消息）</span>}
                        </div>
                        {msg.role === 'user' && (
                          <div className="shrink-0 mt-0.5">
                            <UserIcon className="size-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {expandedId === exec.id && (!exec.messages || exec.messages.length === 0) && (
                  <div className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                    无消息记录（会话可能尚未完成或已被清理）
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
