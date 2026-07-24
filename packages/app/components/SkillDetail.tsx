"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  FolderIcon,
  WrenchIcon,
  SparklesIcon,
  RefreshCwIcon,
} from "lucide-react"
import { nanoid } from "nanoid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DetailPageHeader, type MenuItem } from "@/components/ui/detail-page-header"
import { SkillFileTree } from "@/components/SkillFileTree"
import { SkillFilePreview } from "@/components/SkillFilePreview"
import { useSkillFiles } from "@/hooks/use-skill-files"
import Chat from "@/components/Chat"

// ============================================================
// Types
// ============================================================

export interface SkillView {
  name: string
  folderName: string
  description: string
  whenToUse?: string
  allowedTools: string[]
  model?: string
  effort: "low" | "medium" | "high"
  sourcePath: string
  source: string
  context?: string
  paths?: string[]
}

interface SkillDetailProps {
  skill?: SkillView
  folderName?: string
  onBack?: () => void
}

// ============================================================
// Component
// ============================================================

export default function SkillDetail({
  skill: skillProp,
  folderName,
  onBack,
}: SkillDetailProps) {
  const router = useRouter()
  const skillFolderName = skillProp?.folderName ?? folderName

  // ── 技能元数据 ────────────────────────────────────────────
  const [skill, setSkill] = useState<SkillView | null>(skillProp ?? null)
  const [skillLoading, setSkillLoading] = useState(
    !skillProp && !!folderName,
  )

  // ── 文件树 + 内容 ─────────────────────────────────────────
  const {
    tree,
    selectedPath,
    fileContent,
    isLoading: fileLoading,
    selectFile,
    refresh: refreshFiles,
  } = useSkillFiles(skillFolderName)

  // ── AI 编辑聊天 ───────────────────────────────────────────
  const [showChat, setShowChat] = useState(false)
  const conversationId = useMemo(() => nanoid(), [])

  // ── 加载技能元数据 ────────────────────────────────────────
  useEffect(() => {
    if (skillProp || !folderName) return
    setSkillLoading(true)
    fetch(`/api/skills?folderName=${encodeURIComponent(folderName)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Skill not found")
        return res.json()
      })
      .then((data) => setSkill(data.skill))
      .catch(() => setSkill(null))
      .finally(() => setSkillLoading(false))
  }, [skillProp, folderName])

  // ── 回调 ──────────────────────────────────────────────────
  const handleBack =
    onBack ?? (() => router.push("/settings/skills"))

  const isBuiltin = skill?.source === "builtin"

  // ── 未找到 ────────────────────────────────────────────────
  if (!skillLoading && !skill) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <p>技能未找到</p>
        <Button variant="outline" size="sm" onClick={handleBack}>
          返回列表
        </Button>
      </div>
    )
  }

  const menuItems: MenuItem[] = [
    {
      label: "刷新",
      icon: <RefreshCwIcon className="size-3.5" />,
      onClick: refreshFiles,
    },
  ]

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0">
      <DetailPageHeader
        onBack={handleBack}
        icon={
          <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10">
            <WrenchIcon className="size-4 text-primary" />
          </div>
        }
        title={skill?.name ?? folderName ?? ""}
        badges={skill ? (
          <Badge variant="outline" className="text-xs shrink-0">
            {skill.source}
          </Badge>
        ) : undefined}
        menuItems={menuItems}
        extraButtons={
          isBuiltin ? undefined : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowChat(!showChat)}
              className="shrink-0"
            >
              <SparklesIcon className="mr-1 size-4" />
              AI 编辑
            </Button>
          )
        }
      />

      {/* 主体 */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        <div
          className={
            "flex-1 min-w-0 overflow-hidden flex" +
            (showChat ? " border-r" : "")
          }
        >
          {/* 左：文件树 */}
          <div className="w-64 border-r overflow-hidden flex flex-col shrink-0 bg-muted/20">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <div className="flex items-center gap-1.5 min-w-0">
                <FolderIcon className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {skill?.folderName ?? folderName}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={() => refreshFiles()}
              >
                <RefreshCwIcon className="size-3" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto font-mono text-sm">
              {tree === null ? (
                <div className="text-xs text-muted-foreground p-3">
                  加载中...
                </div>
              ) : tree.length > 0 ? (
                <SkillFileTree
                  nodes={tree}
                  selectedPath={selectedPath}
                  onSelect={selectFile}
                />
              ) : (
                <div className="text-xs text-muted-foreground p-3">
                  没有文件
                </div>
              )}
            </div>
          </div>

          {/* 中：文件预览 */}
          <div className="flex-1 overflow-hidden p-3">
            <SkillFilePreview
              filePath={selectedPath}
              fileContent={fileContent}
              isLoading={fileLoading}
            />
          </div>
        </div>

        {/* 右：AI 编辑聊天 */}
        {showChat && (
          <div className="w-[26.25rem] border-l flex flex-col shrink-0 min-h-0">
            <Chat
              conversationId={conversationId}
              apiEndpoint="/api/skill-workbench"
              extraBody={{ editSkillName: skillFolderName }}
              showAgentSelector={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}
