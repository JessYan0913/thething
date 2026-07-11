'use client'

import { useCallback, useEffect, useState } from "react"
import {
  TimerIcon, ArrowLeftIcon, RefreshCwIcon,
  SaveIcon, PlayIcon, PauseIcon, TrashIcon,
  ClockIcon, ZapIcon, BotIcon,
  ChevronDownIcon, ChevronRightIcon,
  CheckCircleIcon, XCircleIcon,
  UserIcon, MoreVerticalIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type CronJob, type CronExecution } from "@the-thing/core"
import { DetailPageHeader, type MenuItem } from "@/components/ui/detail-page-header"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"

const SCHEDULE_PRESETS = [
  { label: "每分钟", value: "* * * * *" },
  { label: "每 5 分钟", value: "*/5 * * * *" },
  { label: "每小时", value: "0 * * * *" },
  { label: "每天 9:00", value: "0 9 * * *" },
  { label: "工作日 9:00", value: "0 9 * * 1-5" },
  { label: "每周一 9:00", value: "0 9 * * 1" },
]

interface ExecutionMessage {
  id: string
  role: string
  text: string
}

interface CronExecutionWithMessages extends CronExecution {
  messages?: ExecutionMessage[]
}

export default function AutomationDetail({
  jobId,
  onBack,
}: {
  jobId: string
  onBack: () => void
}) {
  const [job, setJob] = useState<CronJob | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit state
  const [editName, setEditName] = useState("")
  const [editPrompt, setEditPrompt] = useState("")
  const [editSchedule, setEditSchedule] = useState("")
  const [editAgentType, setEditAgentType] = useState("")
  const [editEnabled, setEditEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [scheduleExpanded, setScheduleExpanded] = useState(false)

  // Execution history
  const [executions, setExecutions] = useState<CronExecutionWithMessages[]>([])
  const [expandedExecId, setExpandedExecId] = useState<string | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadJob = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/cron/${encodeURIComponent(jobId)}?messages=true&limit=20`)
      if (res.ok) {
        const data = await res.json()
        setJob(data.job)
        setExecutions(data.executions ?? [])
      } else {
        setError("任务不存在")
      }
    } catch {
      setError("加载失败")
    } finally {
      setIsLoading(false)
    }
  }, [jobId])

  useEffect(() => { loadJob() }, [loadJob])

  // Initialize edit form when job loads
  useEffect(() => {
    if (job) {
      setEditName(job.name)
      setEditPrompt(job.prompt)
      setEditSchedule(job.schedule)
      setEditAgentType(job.agentType ?? "")
      setEditEnabled(job.enabled)
      setScheduleExpanded(!!job.schedule)
    }
  }, [job])

  const handleSave = async () => {
    if (!editName.trim() || !editPrompt.trim()) {
      setSaveMessage({ type: 'error', text: '名称和执行指令为必填' })
      return
    }
    const schedule = editSchedule.trim()
    if (schedule && !/^(\S+\s+){4}\S+$/.test(schedule)) {
      setSaveMessage({ type: 'error', text: 'Cron 表达式格式无效，需要 5 个字段' })
      return
    }
    setSaving(true)
    setSaveMessage(null)
    try {
      const body: Record<string, unknown> = {
        name: editName.trim(),
        prompt: editPrompt.trim(),
      }
      if (schedule) body.schedule = schedule
      else body.schedule = ""
      if (editAgentType.trim()) body.agentType = editAgentType.trim()
      else body.agentType = undefined
      if (schedule) body.enabled = editEnabled

      const res = await fetch(`/api/cron/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSaveMessage({ type: 'success', text: '保存成功' })
        loadJob()
      } else {
        const data = await res.json()
        setSaveMessage({ type: 'error', text: data.error || '保存失败' })
      }
    } catch {
      setSaveMessage({ type: 'error', text: '网络错误' })
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    if (!job || !job.schedule) return
    const action = job.enabled ? "disable" : "enable"
    const res = await fetch(`/api/cron/${jobId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    if (res.ok) loadJob()
  }

  const handleTrigger = async () => {
    await fetch(`/api/cron/${jobId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "trigger" }),
    })
    loadJob()
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/cron/${encodeURIComponent(jobId)}`, { method: "DELETE" })
      if (res.ok) onBack()
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        加载中...
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <TimerIcon className="size-12 opacity-20" />
        <p className="text-sm">{error || "任务不存在"}</p>
        <Button size="sm" onClick={onBack}>返回</Button>
      </div>
    )
  }

  const menuItems: MenuItem[] = [
    {
      label: "执行",
      icon: <PlayIcon className="size-3.5" />,
      onClick: handleTrigger,
    },
    ...(job.schedule ? [
      {
        label: job.enabled ? "暂停" : "启用",
        icon: job.enabled ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />,
        onClick: handleToggle,
      },
    ] : []),
    {
      label: "刷新",
      icon: <RefreshCwIcon className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />,
      onClick: loadJob,
    },
    { divider: true, label: "", icon: null, onClick: () => {} },
    {
      label: "删除",
      icon: <TrashIcon className="size-3.5" />,
      onClick: () => setShowDeleteConfirm(true),
      destructive: true,
    },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      <DetailPageHeader
        onBack={onBack}
        icon={<TimerIcon />}
        title={job.name}
        badges={
          <>
            <Badge variant="secondary" className="text-xs font-mono">{job.id}</Badge>
            <Badge
              variant={job.enabled ? "default" : "secondary"}
              className="text-xs"
            >
              {job.enabled ? "已启用" : "已禁用"}
            </Badge>
            {job.metadata?.source === 'task-file' && (
              <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400">
                文件定义
              </Badge>
            )}
          </>
        }
        onSave={handleSave}
        saving={saving}
        saveMessage={saveMessage}
        menuItems={menuItems}
      />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-2xl mx-auto px-8 py-8 space-y-8">

          {/* ═══ 执行指令 ═══ */}
          <section className="space-y-3">
            <div className="flex items-center gap-1.5">
              <ZapIcon className="size-4 text-primary" />
              <p className="text-sm font-medium text-muted-foreground">执行指令</p>
            </div>
            <Textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="输入 Agent 要执行的指令"
              rows={8}
              className="text-sm leading-relaxed resize-y min-h-32"
            />
          </section>

          {/* ═══ 基础配置 ═══ */}
          <section className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">任务名称</p>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="例如：每日黄金价格查询"
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Agent 类型 <span className="text-xs text-muted-foreground/50">（可选）</span></p>
                <Input
                  value={editAgentType}
                  onChange={(e) => setEditAgentType(e.target.value)}
                  placeholder="留空使用默认 Agent"
                  className="h-10 text-sm"
                />
              </div>
            </div>
          </section>

          {/* ═══ 定时执行 ═══ */}
          <section className="rounded-lg border overflow-hidden">
            <button
              type="button"
              onClick={() => setScheduleExpanded(!scheduleExpanded)}
              className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
            >
              {scheduleExpanded
                ? <ChevronDownIcon className="size-4 text-muted-foreground shrink-0" />
                : <ChevronRightIcon className="size-4 text-muted-foreground shrink-0" />
              }
              <ClockIcon className="size-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium">定时执行</span>
              {editSchedule ? (
                <code className="text-xs font-mono text-muted-foreground ml-1">
                  {editSchedule}
                </code>
              ) : (
                <span className="text-xs text-muted-foreground font-normal">（未设置，任务只能手动触发）</span>
              )}
            </button>

            {scheduleExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t pt-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Cron 表达式</label>
                  <Input
                    value={editSchedule}
                    onChange={(e) => setEditSchedule(e.target.value)}
                    placeholder="分 时 日 月 周，例如 0 9 * * 1-5"
                    className="font-mono text-sm"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {SCHEDULE_PRESETS.map(p => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => {
                          setEditSchedule(p.value)
                          setEditEnabled(true)
                        }}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          editSchedule === p.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'hover:bg-muted'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {editSchedule && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditEnabled(!editEnabled)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        editEnabled
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <span className={`size-1.5 rounded-full ${editEnabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {editEnabled ? '启用' : '已暂停'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ═══ 执行历史 ═══ */}
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {historyExpanded
                ? <ChevronDownIcon className="size-4" />
                : <ChevronRightIcon className="size-4" />
              }
              执行历史 ({executions.length})
            </button>

            {historyExpanded && (
              <div className="space-y-2">
                {executions.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">暂无执行记录</p>
                ) : (
                  executions.map(exec => (
                    <div key={exec.id} className="rounded-lg border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedExecId(prev => prev === exec.id ? null : exec.id)}
                        className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors text-xs"
                      >
                        {exec.status === 'completed' && (
                          <CheckCircleIcon className="size-3.5 text-green-500 shrink-0" />
                        )}
                        {exec.status === 'failed' && (
                          <XCircleIcon className="size-3.5 text-destructive shrink-0" />
                        )}
                        {exec.status === 'triggered' && (
                          <ClockIcon className="size-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span>{new Date(exec.triggeredAt).toLocaleString()}</span>
                        {exec.duration != null && (
                          <span className="text-muted-foreground font-mono">
                            {exec.duration < 1000 ? `${exec.duration}ms` : `${(exec.duration / 1000).toFixed(1)}s`}
                          </span>
                        )}
                        {exec.error && (
                          <span className="text-destructive truncate max-w-[200px]">{exec.error}</span>
                        )}
                        <div className="ml-auto shrink-0">
                          {expandedExecId === exec.id
                            ? <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                            : <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                          }
                        </div>
                      </button>

                      {expandedExecId === exec.id && exec.messages && exec.messages.length > 0 && (
                        <div className="border-t bg-muted/20 px-3 py-2 space-y-2">
                          {exec.messages.map(msg => (
                            <div
                              key={msg.id}
                              className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              {msg.role !== 'user' && (
                                <div className="shrink-0 mt-0.5">
                                  <BotIcon className="size-3.5 text-muted-foreground" />
                                </div>
                              )}
                              <div
                                className={`rounded-lg px-2.5 py-1.5 text-xs max-w-[80%] whitespace-pre-wrap ${
                                  msg.role === 'user'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-background border'
                                }`}
                              >
                                {msg.text || <span className="text-muted-foreground italic">（空消息）</span>}
                              </div>
                              {msg.role === 'user' && (
                                <div className="shrink-0 mt-0.5">
                                  <UserIcon className="size-3.5 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {expandedExecId === exec.id && (!exec.messages || exec.messages.length === 0) && (
                        <div className="border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          无消息记录
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDelete}
        itemName={job.name}
        deleting={deleting}
      />
    </div>
  )
}
