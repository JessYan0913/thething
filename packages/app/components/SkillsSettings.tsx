import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  WrenchIcon, RefreshCwIcon, FolderIcon,
  PlusIcon, MoreVerticalIcon,
  Trash2Icon, SearchIcon, SparklesIcon,
  ExternalLinkIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UploadSkillDialog } from "@/components/SkillUploadDialog"
import type { SkillView } from "@/components/SkillDetail"

// ============================================================
// ============================================================

const effortLabels: Record<string, string> = {
  low: "轻量",
  medium: "中等",
  high: "高开销",
}

const effortColors: Record<string, string> = {
  low: "bg-green-500/15 text-green-700 dark:text-green-400",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
}

// ============================================================
// Main Component
// ============================================================

export default function SkillsSettings() {
  const router = useRouter()
  const [skills, setSkills] = useState<SkillView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillView | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const loadSkills = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/skills")
      if (res.ok) {
        const data = await res.json()
        setSkills(data.skills ?? [])
      }
    } catch {
      setSkills([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadSkills() }, [loadSkills])

  const filteredSkills = useMemo(() => {
    if (!searchQuery) return skills
    const q = searchQuery.toLowerCase()
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    )
  }, [skills, searchQuery])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const res = await fetch(
        `/api/skills?name=${encodeURIComponent(deleteTarget.folderName)}`,
        { method: "DELETE" },
      )
      if (res.ok) {
        setSkills((prev) => prev.filter((s) => s.folderName !== deleteTarget.folderName))
        setMessage({ type: "success", text: "Skill 已删除" })
      } else {
        const data = await res.json()
        throw new Error(data.error || "删除失败")
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "删除失败" })
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
      setTimeout(() => setMessage(null), 3000)
    }
  }, [deleteTarget])

  const handleUploadSuccess = useCallback(() => {
    setMessage({ type: "success", text: "Skill 上传成功" })
    loadSkills()
    setTimeout(() => setMessage(null), 3000)
  }, [loadSkills])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Message toast */}
      {message && (
        <div className={`mx-6 mt-3 px-3 py-2 rounded-md text-sm ${
          message.type === "success"
            ? "bg-green-500/10 text-green-700 dark:text-green-400"
            : "bg-red-500/10 text-red-700 dark:text-red-400"
        }`}>
          {message.text}
        </div>
      )}

      {/* Skills.sh banner */}
      <div className="shrink-0 mx-6 mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-400 text-xs">
        <span>从</span>
        <a
          href="https://skills.sh"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 font-medium hover:underline"
        >
          skills.sh
          <ExternalLinkIcon className="size-3" />
        </a>
        <span>浏览技能，复制名称后在对话中发送「安装 xxx 技能」即可安装</span>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={loadSkills} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="sm" onClick={() => router.push('/settings/workbench/skill')}>
          <SparklesIcon className="mr-1 size-4" />
          AI 生成
        </Button>
        <Button size="sm" onClick={() => setIsUploadOpen(true)}>
          <PlusIcon className="mr-1 size-4" />
          上传 Skill
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <WrenchIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">
                {searchQuery ? "未找到匹配的技能" : "暂无技能"}
              </p>
              <p className="text-xs">
                {searchQuery
                  ? "尝试更换关键词搜索"
                  : "上传包含 SKILL.md 文件的文件夹，或在对话中安装新技能"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
            {filteredSkills.map((skill) => (
              <SkillCard
                key={skill.folderName}
                skill={skill}
                onClick={() => router.push(`/settings/skills/${encodeURIComponent(skill.folderName)}`)}
                onDelete={() => setDeleteTarget(skill)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <UploadSkillDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onSuccess={handleUploadSuccess}
      />

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !isDeleting && setDeleteTarget(null)}>
          <div
            className="bg-background rounded-lg border shadow-lg max-w-sm w-full mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">确认删除</h3>
              <p className="text-sm text-muted-foreground">
                确定要删除技能 "{deleteTarget.name}" 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "删除中..." : "确认删除"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// SkillCard — 技能列表卡片
// ============================================================

function SkillCard({
  skill,
  onClick,
  onDelete,
}: {
  skill: SkillView
  onClick: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      className="rounded-lg border p-4 space-y-3 w-full hover:border-accent/50 hover:bg-accent/20 transition-colors relative overflow-hidden"
    >
      <div className="flex items-start justify-between gap-4 min-w-0">
        <button
          onClick={onClick}
          className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer"
        >
          <WrenchIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-medium text-sm truncate">{skill.name}</span>
              <Badge
                className={`text-xs border-0 ${effortColors[skill.effort] ?? effortColors.medium}`}
              >
                {effortLabels[skill.effort] ?? skill.effort}
              </Badge>
              {skill.model && (
                <Badge variant="outline" className="text-xs font-mono">
                  {skill.model}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {skill.description}
            </p>
            {skill.whenToUse && (
              <p className="text-xs text-muted-foreground/60 italic">
                适用场景：{skill.whenToUse}
              </p>
            )}
          </div>
        </button>

        {/* Actions menu */}
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
                  <Trash2Icon className="size-3.5" />
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground min-w-0">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <FolderIcon className="size-3 shrink-0" />
          <span className="truncate" title={skill.sourcePath}>
            {skill.sourcePath}
          </span>
        </div>
        <span className="text-muted-foreground/40">|</span>
        <Badge variant="outline" className="text-xs">
          {skill.source}
        </Badge>
      </div>
    </div>
  )
}
