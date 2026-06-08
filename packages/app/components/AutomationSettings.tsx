import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  TimerIcon, RefreshCwIcon, PlusIcon,
  TrashIcon, CheckIcon, XIcon,
  PlayIcon, PauseIcon, AlertCircleIcon,
  ZapIcon, HistoryIcon, StopCircleIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { type CronJob } from "@the-thing/core"

const SCHEDULE_PRESETS = [
  { label: "每分钟", value: "* * * * *" },
  { label: "每 5 分钟", value: "*/5 * * * *" },
  { label: "每小时", value: "0 * * * *" },
  { label: "每天 9:00", value: "0 9 * * *" },
  { label: "工作日 9:00", value: "0 9 * * 1-5" },
  { label: "每周一 9:00", value: "0 9 * * 1" },
]

export default function AutomationSettings() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [formName, setFormName] = useState("")
  const [formSchedule, setFormSchedule] = useState("")
  const [formPrompt, setFormPrompt] = useState("")
  const [formAgentType, setFormAgentType] = useState("")
  const [formEnabled, setFormEnabled] = useState(true)

  const loadJobs = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/cron")
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs ?? [])
      }
    } catch {
      setJobs([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])

  const openCreate = () => {
    setEditingJob(null)
    setFormName("")
    setFormSchedule("")
    setFormPrompt("")
    setFormAgentType("")
    setFormEnabled(true)
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (job: CronJob) => {
    setEditingJob(job)
    setFormName(job.name)
    setFormSchedule(job.schedule)
    setFormPrompt(job.prompt)
    setFormAgentType(job.agentType ?? "")
    setFormEnabled(job.enabled)
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formName.trim() || !formSchedule.trim() || !formPrompt.trim()) {
      setFormError("名称、调度表达式、执行指令均为必填")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        name: formName.trim(),
        schedule: formSchedule.trim(),
        prompt: formPrompt.trim(),
        enabled: formEnabled,
      }
      if (formAgentType.trim()) body.agentType = formAgentType.trim()

      if (editingJob) {
        const res = await fetch(`/api/cron/${editingJob.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json()
          setFormError(data.error || "更新失败")
          return
        }
      } else {
        const res = await fetch("/api/cron", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json()
          setFormError(data.error || "创建失败")
          return
        }
      }
      setDialogOpen(false)
      loadJobs()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "操作失败")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/cron/${id}`, { method: "DELETE" })
    setJobs(prev => prev.filter(j => j.id !== id))
    setConfirmDelete(null)
  }, [])

  const handleToggle = useCallback(async (job: CronJob) => {
    const action = job.enabled ? "disable" : "enable"
    const res = await fetch(`/api/cron/${job.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    if (res.ok) loadJobs()
  }, [loadJobs])

  const handleTrigger = useCallback(async (job: CronJob) => {
    await fetch(`/api/cron/${job.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "trigger" }),
    })
    loadJobs()
  }, [loadJobs])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <Badge variant="secondary" className="text-xs">
          {jobs.length} 个任务
        </Badge>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadJobs} disabled={isLoading}>
            <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={openCreate}>
            <PlusIcon className="size-4 mr-1" />
            新建任务
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <TimerIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">暂无自动化任务</p>
              <p className="text-xs">
                创建定时任务让 Agent 按计划自动执行，也可以在对话中使用 cron 工具创建
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                onEdit={() => openEdit(job)}
                onTrigger={() => handleTrigger(job)}
                onToggle={() => handleToggle(job)}
                onDelete={() => handleDelete(job.id)}
                confirmDelete={confirmDelete === job.id}
                onConfirmDelete={() => setConfirmDelete(job.id)}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingJob ? "编辑任务" : "新建自动化任务"}</DialogTitle>
            <DialogDescription>
              {editingJob ? "修改定时任务配置" : "创建一个定时执行的 Agent 任务"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">任务名称</label>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="例如：每日数据汇总"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">调度表达式 (Cron)</label>
              <Input
                value={formSchedule}
                onChange={e => setFormSchedule(e.target.value)}
                placeholder="分 时 日 月 周，例如 0 9 * * 1-5"
                className="font-mono"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SCHEDULE_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setFormSchedule(p.value)}
                    className="text-xs px-2 py-0.5 rounded-full border hover:bg-muted transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">执行指令</label>
              <Textarea
                value={formPrompt}
                onChange={e => setFormPrompt(e.target.value)}
                placeholder="Agent 将按此指令执行任务..."
                className="min-h-[100px]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Agent 类型 <span className="text-muted-foreground font-normal">(可选)</span></label>
              <Input
                value={formAgentType}
                onChange={e => setFormAgentType(e.target.value)}
                placeholder="留空使用默认 Agent"
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircleIcon className="size-4 shrink-0" />
                {formError}
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : editingJob ? "保存修改" : "创建任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function JobCard({
  job,
  onEdit,
  onTrigger,
  onToggle,
  onDelete,
  confirmDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  job: CronJob
  onEdit: () => void
  onTrigger: () => void
  onToggle: () => void
  onDelete: () => void
  confirmDelete: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  return (
    <div className="rounded-lg border w-full text-left">
      {/* Main card content */}
      <div
        role="button"
        tabIndex={0}
        onClick={onEdit}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit() } }}
        className="p-4 space-y-3 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <TimerIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{job.name}</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    job.enabled
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  }`}
                >
                  <span className={`size-1.5 rounded-full ${job.enabled ? "bg-green-500" : "bg-red-500"}`} />
                  {job.enabled ? "运行中" : "已停止"}
                </span>
                <code className="text-xs text-muted-foreground/70 font-mono bg-muted px-1.5 py-0.5 rounded">
                  {job.schedule}
                </code>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {job.prompt}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={e => { e.stopPropagation(); onTrigger() }}
            >
              <ZapIcon className="size-3" />
              执行
            </Button>

            <Button
              variant={job.enabled ? "secondary" : "default"}
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={e => { e.stopPropagation(); onToggle() }}
            >
              {job.enabled
                ? <><StopCircleIcon className="size-3" /> 停用</>
                : <><PlayIcon className="size-3" /> 启用</>
              }
            </Button>

            {confirmDelete ? (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={e => { e.stopPropagation(); onDelete() }}
                >
                  <CheckIcon className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={e => { e.stopPropagation(); onCancelDelete() }}
                >
                  <XIcon className="size-3" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={e => { e.stopPropagation(); onConfirmDelete() }}
              >
                <TrashIcon className="size-3" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {job.agentType && (
            <Badge variant="outline" className="text-xs">{job.agentType}</Badge>
          )}
          {job.lastRunAt && (
            <span>上次执行: {new Date(job.lastRunAt).toLocaleString()}</span>
          )}
          <span>下次执行: {new Date(job.nextRunAt).toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          <span className="font-mono">{job.id}</span>
        </div>
      </div>

      {/* Execution history link */}
      <div className="border-t">
        <Link
          href={`/settings/automation/${job.id}`}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1.5 w-full px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          <HistoryIcon className="size-3" />
          <span>执行记录</span>
        </Link>
      </div>
    </div>
  )
}
