'use client'

import { useCallback, useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ArrowLeftIcon, TrashIcon, CheckIcon, PencilIcon,
  RefreshCwIcon, BrainIcon, UserIcon, BotIcon, FolderIcon,
  GlobeIcon, BoxIcon, Loader2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { DetailPageHeader, type MenuItem } from "@/components/ui/detail-page-header"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { FileLink } from "@/components/ui/file-link"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface WikiPageView {
  name: string
  description: string
  category: string
  content: string
  filename: string
  created: string
  updated: string
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

  // 删除确认
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const loadPage = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/memory")
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
      const res = await fetch("/api/memory", {
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
    const res = await fetch(`/api/memory?filename=${encodeURIComponent(page.filename)}`, { method: "DELETE" })
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

  const config = categoryConfig[page.category]

  const menuItems: MenuItem[] = [
    ...(!editing ? [
      {
        label: "编辑",
        icon: <PencilIcon className="size-3.5" />,
        onClick: handleStartEdit,
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
        icon={config ? <span className={cn(config.color)}>{config.icon}</span> : undefined}
        title={page.name}
        badges={config ? (
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full",
            page.category === "user" && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            page.category === "agent" && "bg-purple-500/10 text-purple-600 dark:text-purple-400",
            page.category === "project" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            page.category === "domain" && "bg-green-500/10 text-green-600 dark:text-green-400",
            page.category === "entity" && "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
          )}>
            {config.label}
          </span>
        ) : undefined}
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

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {editing ? (
          <div className="flex flex-col h-full min-h-0 p-6 gap-3">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="flex-1 min-h-0 text-sm font-mono resize-none"
              autoFocus
            />
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="ghost" onClick={handleCancelEdit}>取消</Button>
              <span className="text-[11px] text-muted-foreground/40">Ctrl+S 保存</span>
            </div>
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none p-6">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="border-collapse border w-full text-sm">{children}</table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="border-b bg-muted/50">{children}</thead>
                ),
                tbody: ({ children }) => (
                  <tbody>{children}</tbody>
                ),
                tr: ({ children }) => (
                  <tr className="border-b hover:bg-muted/30">{children}</tr>
                ),
                th: ({ children }) => (
                  <th className="border px-3 py-2 text-left font-medium">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="border px-3 py-2">{children}</td>
                ),
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl font-bold mt-5 mb-2">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-lg font-bold mt-4 mb-2">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="my-2 leading-relaxed">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc ml-6 my-2">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal ml-6 my-2">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="my-1">{children}</li>
                ),
                code: ({ className, children }) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className={className}>{children}</code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="rounded-md bg-muted p-4 overflow-x-auto my-4">
                    {children}
                  </pre>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-4 italic text-muted-foreground">
                    {children}
                  </blockquote>
                ),
                hr: () => (
                  <hr className="my-6 border-t" />
                ),
                a: ({ href, children }) => {
                  // 检测是否是文件路径
                  const isFilePath = href && (
                    href.startsWith('/') ||
                    href.startsWith('file://') ||
                    href.match(/\.\w+$/)
                  )

                  if (isFilePath) {
                    return (
                      <FileLink href={href}>
                        {children}
                      </FileLink>
                    )
                  }

                  return (
                    <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  )
                },
                strong: ({ children }) => (
                  <strong className="font-bold">{children}</strong>
                ),
              }}
            >
              {page.content}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-6 py-1.5 border-t text-[11px] text-muted-foreground/40 flex items-center gap-3">
        <span>{page.lines} 行</span>
        <span>{page.sizeKb.toFixed(1)} KB</span>
        <span className="ml-auto">更新于 {getRelativeTime(page.updated)}</span>
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
