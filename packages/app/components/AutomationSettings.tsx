'use client'

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  TimerIcon, RefreshCwIcon, PlusIcon,
  TrashIcon, CheckIcon, XIcon,
  PlayIcon, PauseIcon, AlertCircleIcon,
  ZapIcon, HistoryIcon, StopCircleIcon, SearchIcon,
  ChevronDownIcon, ChevronRightIcon,
  ClockIcon, MoreVerticalIcon,
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

function hasSchedule(job: CronJob): boolean {
  return !!job.schedule
}

export default function AutomationSettings() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const [scheduleExpanded, setScheduleExpanded] = useState(false)

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
    setFormEnabled(false)
    setScheduleExpanded(false)
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formName.trim() || !formPrompt.trim()) {
      setFormError("名称和执行指令为必填")
      return
    }
    const schedule = formSchedule.trim()
    if (schedule && !/^(\S+\s+){4}\S+$/.test(schedule)) {
      setFormError("Cron 表达式格式无效，需要 5 个字段")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        name: formName.trim(),
        prompt: formPrompt.trim(),
      }
      if (schedule) body.schedule = schedule
      if (formAgentType.trim()) body.agentType = formAgentType.trim()
      // 有 schedule 时才允许启用
      if (schedule) body.enabled = formEnabled

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
      if (!editingJob) {
        // 新建后跳转到详情页
        const data = await res.json().catch(() => ({}))
        const newId = data.job?.id
        if (newId) {
          router.push(`/settings/automation/${newId}`)
          return
        }
      }
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
    if (!hasSchedule(job)) return // 无 schedule 的任务不能启用
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

  const filteredJobs = useMemo(() => {
    if (!search) return jobs
    const q = search.toLowerCase()
    return jobs.filter((j) => {
      const name = j.name.toLowerCase()
      const prompt = j.prompt.toLowerCase()
      const agent = (j.agentType ?? "").toLowerCase()
      return name.includes(q) || prompt.includes(q) || agent.includes(q)
    })
  }, [jobs, search])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索自动化任务..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={loadJobs} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="size-4 mr-1" />
          新建任务
        </Button>
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
              <p className="text-sm font-medium">
                {search ? "没有匹配的任务" : "暂无自动化任务"}
              </p>
              <p className="text-xs">
                创建定时任务让 Agent 按计划自动执行，也可以在对话中使用 cron 工具创建
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredJobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                onEdit={() => router.push(`/settings/automation/${job.id}`)}
                onTrigger={() => handleTrigger(job)}
                onToggle={() => handleToggle(job)}
                onDelete={() => handleDelete(job.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(null)}>
          <div
            className="bg-background rounded-lg border shadow-lg max-w-sm w-full mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">确认删除</h3>
              <p className="text-sm text-muted-foreground">
                确定要删除任务 &ldquo;{jobs.find(j => j.id === confirmDelete)?.name}&rdquo; 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(confirmDelete)}>
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) { setDialogOpen(false); return }
        setDialogOpen(true)
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingJob ? "编辑任务" : "新建自动化任务"}</DialogTitle>
            <DialogDescription>
              {editingJob ? "修改任务内容和定时配置" : "定义任务做什么，可选择配置定时执行"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* ═══════════════════════════════════════════
               核心：任务指令
               ═══════════════════════════════════════════ */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <ZapIcon className="size-3.5 text-primary" />
                执行指令 <span className="text-muted-foreground font-normal">— Agent 将按此指令执行任务</span>
              </label>
              <Textarea
                value={formPrompt}
                onChange={e => setFormPrompt(e.target.value)}
                placeholder="输入 Agent 要执行的指令，例如：&#10;查询今日黄金价格，从 Kitco 获取国际金价...&#10;将结果整理成 markdown 格式保存..."
                className="min-h-40 text-sm leading-relaxed"
                autoFocus={!editingJob}
              />
            </div>

            {/* 任务名称 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">任务名称</label>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="例如：每日黄金价格查询"
              />
            </div>

            {/* ═══════════════════════════════════════════
               折叠：定时执行
               ═══════════════════════════════════════════ */}
            <div className="rounded-lg border">
              <button
                type="button"
                onClick={() => setScheduleExpanded(!scheduleExpanded)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-muted/50 transition-colors rounded-lg"
              >
                {scheduleExpanded
                  ? <ChevronDownIcon className="size-4 text-muted-foreground shrink-0" />
                  : <ChevronRightIcon className="size-4 text-muted-foreground shrink-0" />
                }
                <ClockIcon className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">定时执行</span>
                {formSchedule ? (
                  <code className="text-xs font-mono text-muted-foreground ml-1">
                    {formSchedule}
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
                      value={formSchedule}
                      onChange={e => setFormSchedule(e.target.value)}
                      placeholder="分 时 日 月 周，例如 0 9 * * 1-5"
                      className="font-mono text-sm"
                    />
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {SCHEDULE_PRESETS.map(p => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => {
                            setFormSchedule(p.value)
                            setFormEnabled(true)
                          }}
                          className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                            formSchedule === p.value
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'hover:bg-muted'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {formSchedule && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFormEnabled(!formEnabled)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          formEnabled
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${formEnabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {formEnabled ? '启用' : '已暂停'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Agent 类型 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Agent 类型 <span className="text-muted-foreground font-normal">（可选）</span>
              </label>
              <Input
                value={formAgentType}
                onChange={e => setFormAgentType(e.target.value)}
                placeholder="留空使用默认 Agent"
                className="text-sm"
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-lg px-3 py-2">
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

function JobMenu({ onDelete }: { onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen(!menuOpen)
        }}
      >
        <MoreVerticalIcon className="size-4" />
      </Button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-36 rounded-md border bg-popover shadow-md">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 cursor-pointer rounded-md"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                onDelete()
              }}
            >
              <TrashIcon className="size-3.5" />
              删除
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function JobCard({
  job,
  onEdit,
  onTrigger,
  onToggle,
  onDelete,
}: {
  job: CronJob
  onEdit: () => void
  onTrigger: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const scheduled = hasSchedule(job)

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
                {/* 来源徽章 */}
                {job.metadata?.source === 'task-file' ? (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    文件定义
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                    手动创建
                  </span>
                )}
                {scheduled ? (
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
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                    <ClockIcon className="size-3" />
                    手动触发
                  </span>
                )}
                {scheduled && (
                  <code className="text-xs text-muted-foreground/70 font-mono bg-muted px-1.5 py-0.5 rounded">
                    {job.schedule}
                  </code>
                )}
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

            {scheduled && (
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
            )}

            {/* 3-dot menu */}
            <JobMenu onDelete={onDelete} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {job.agentType && (
            <Badge variant="outline" className="text-xs">{job.agentType}</Badge>
          )}
          {job.lastRunAt && (
            <span>上次执行: {new Date(job.lastRunAt).toLocaleString()}</span>
          )}
          {scheduled ? (
            <span>下次执行: {new Date(job.nextRunAt).toLocaleString()}</span>
          ) : (
            <span className="text-muted-foreground/50">未设置定时执行</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground/60 flex-wrap">
          <span className="font-mono">{job.id}</span>
          {(() => {
            const fp = job.metadata?.filePath;
            return typeof fp === 'string' ? (
              <span className="truncate max-w-75" title={fp}>
                📄 {fp.replace(/^.*\/\.agents\//, '~/.agents/')}
              </span>
            ) : null;
          })()}
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
