'use client'

import { useCallback, useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  TrashIcon, PencilIcon, HistoryIcon,
  BrainIcon, UserIcon, BotIcon, FolderIcon,
  GlobeIcon, BoxIcon, Loader2Icon, LinkIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import MarkdownEditor from "@/components/markdown-editor"
import { cn } from "@/lib/utils"
import { getWikiCategoryMeta } from "@/lib/wiki-category"
import { DetailPageHeader, type MenuItem } from "@/components/ui/detail-page-header"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { FileLink } from "@/components/ui/file-link"
import WikiHistoryPanel from "@/components/WikiHistoryPanel"

interface WikiSourceView {
  type: string
  value: string
  revision?: string
  title?: string
}

interface WikiPageView {
  name: string
  description: string
  category: string
  content: string
  filename: string
  created: string
  updated: string
  origin?: string
  sources: WikiSourceView[]
  lines: number
  sizeKb: number
}

const categoryConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  user: { label: "用户", icon: <UserIcon className="size-3.5" />, color: "text-blue-500" },
  agent: { label: "Agent", icon: <BotIcon className="size-3.5" />, color: "text-purple-500" },
  project: { label: "项目", icon: <FolderIcon className="size-3.5" />, color: "text-amber-500" },
  domain: { label: "领域", icon: <GlobeIcon className="size-3.5" />, color: "text-green-500" },
  entity: { label: "实体", icon: <BoxIcon className="size-3.5" />, color: "text-cyan-500" },
}

// 分类是自由字符串：未知分类用中性样式兜底渲染。
function getCategoryView(category: string) {
  return categoryConfig[category] ?? {
    label: getWikiCategoryMeta(category).label,
    icon: <BrainIcon className="size-3.5" />,
    color: "text-slate-500",
  }
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  url: "URL",
  file: "文件",
  git: "Git",
  conversation: "对话",
  other: "其他",
}

function getRelativeTime(dateStr: string) {
  const ageMs = Date.now() - new Date(dateStr).getTime()
  const ageDays = Math.floor(ageMs / 86400000)
  if (ageDays < 1) return "今天"
  if (ageDays < 30) return `${ageDays}天前`
  if (ageDays < 365) return `${Math.floor(ageDays / 30)}个月前`
  return `${Math.floor(ageDays / 365)}年前`
}

export default function WikiDetail({
  filename,
  onBack,
}: {
  filename: string
  onBack: () => void
}) {
  const [page, setPage] = useState<WikiPageView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 编辑状态
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  // 修订历史面板
  const [showHistory, setShowHistory] = useState(false)

  // 删除确认
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const loadPage = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/wiki")
      if (res.ok) {
        const data = await res.json()
        const pages = data.pages ?? []
        const found = pages.find((p: WikiPageView) => p.filename === filename)
        if (found) {
          setPage(found)
        } else {
          setError("页面不存在")
        }
      }
    } catch {
      setError("加载失败")
    } finally {
      setIsLoading(false)
    }
  }, [filename])

  useEffect(() => { loadPage() }, [loadPage])

  const handleStartEdit = useCallback(() => {
    if (!page) return
    setEditing(true)
    setEditContent(page.content)
  }, [page])

  const handleCancelEdit = useCallback(() => {
    setEditing(false)
    setEditContent("")
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!page || !editContent.trim()) return
    setEditSaving(true)
    try {
      const res = await fetch("/api/wiki", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: page.filename,
          name: page.name,
          description: page.description,
          category: page.category,
          content: editContent.trim(),
        }),
      })
      if (res.ok) {
        await loadPage()
        setEditing(false)
        setEditContent("")
      }
    } finally {
      setEditSaving(false)
    }
  }, [page, editContent, loadPage])

  const handleDelete = useCallback(async () => {
    if (!page) return
    const res = await fetch(`/api/wiki?filename=${encodeURIComponent(page.filename)}`, { method: "DELETE" })
    if (res.ok) onBack()
    setShowDeleteConfirm(false)
  }, [page, onBack])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin mr-2" />
        加载中...
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <BrainIcon className="size-12 opacity-20" />
        <p className="text-sm">{error || "页面不存在"}</p>
        <Button size="sm" onClick={onBack}>返回</Button>
      </div>
    )
  }

  const config = getCategoryView(page.category)

  const menuItems: MenuItem[] = [
    ...(!editing ? [
      {
        label: "编辑",
        icon: <PencilIcon className="size-3.5" />,
        onClick: handleStartEdit,
      },
      {
        label: "修订历史",
        icon: <HistoryIcon className="size-3.5" />,
        onClick: () => setShowHistory(true),
      },
    ] : []),
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
        icon={<span className={cn(config.color)}>{config.icon}</span>}
        title={page.name}
        badges={
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full",
            getWikiCategoryMeta(page.category).chip,
          )}>
            {config.label}
          </span>
        }
        onSave={editing ? handleSaveEdit : undefined}
        saving={editSaving}
        menuItems={menuItems}
      />

      {/* Description */}
      {page.description && !editing && (
        <div className="shrink-0 px-6 py-2 border-b bg-muted/20">
          <p className="text-xs text-muted-foreground">{page.description}</p>
        </div>
      )}

      {/* Body: content + optional history panel */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-h-0 overflow-auto">
          {editing ? (
            <div className="flex flex-col h-full min-h-0 p-6 gap-3">
              <MarkdownEditor
                value={editContent}
                onChange={setEditContent}
                onSave={handleSaveEdit}
                className="flex-1 min-h-0"
              />
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={handleCancelEdit}>取消</Button>
                <span className="text-[11px] text-muted-foreground/40">Ctrl+S 保存</span>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-4">
                        <table className="border-collapse border w-full text-sm">{children}</table>
                      </div>
                    ),
                    a: ({ href, children }) => {
                      if (href && (href.startsWith("/") || href.startsWith("~"))) {
                        return <FileLink href={href}>{children}</FileLink>
                      }
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      )
                    },
                  }}
                >
                  {page.content}
                </ReactMarkdown>
              </div>

              {/* Sources */}
              {page.sources.length > 0 && (
                <div className="border-t pt-4 space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <LinkIcon className="size-3.5" />
                    来源（{page.sources.length}）
                  </p>
                  <ul className="space-y-1.5">
                    {page.sources.map((source, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground mt-px">
                          {SOURCE_TYPE_LABELS[source.type] ?? source.type}
                        </span>
                        <span className="min-w-0">
                          {source.type === "url" ? (
                            <a
                              href={source.value}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline break-all"
                            >
                              {source.title || source.value}
                            </a>
                          ) : (
                            <span className="break-all">{source.title || source.value}</span>
                          )}
                          {source.revision && (
                            <span className="text-muted-foreground/60 ml-1.5 font-mono text-[10px]">
                              @{source.revision.slice(0, 12)}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Meta footer */}
              <div className="border-t pt-3 flex items-center gap-3 text-[10px] text-muted-foreground/60">
                <span>{page.lines} 行</span>
                <span>{page.sizeKb.toFixed(1)} KB</span>
                <span>更新于 {getRelativeTime(page.updated)}</span>
                {page.origin && <span>origin: {page.origin}</span>}
              </div>
            </div>
          )}
        </div>

        {/* History panel */}
        {showHistory && !editing && (
          <div className="w-96 shrink-0 min-h-0">
            <WikiHistoryPanel
              filename={page.filename}
              onClose={() => setShowHistory(false)}
              onRestored={loadPage}
            />
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDelete}
        itemName={page.name}
      />
    </div>
  )
}
