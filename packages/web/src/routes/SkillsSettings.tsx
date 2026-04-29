import { useCallback, useEffect, useState } from "react"
import {
  WrenchIcon, RefreshCwIcon, FolderIcon, LayersIcon,
  ArrowLeftIcon, PanelLeftOpenIcon, PanelRightOpenIcon,
  TagIcon, TargetIcon, InfoIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DirectoryTree } from "@/components/DirectoryTree"
import { FilePreview } from "@/components/FilePreview"
import { cn } from "@/lib/utils"

interface SkillView {
  name: string
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

export default function SkillsSettings() {
  const [skills, setSkills] = useState<SkillView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSkill, setSelectedSkill] = useState<SkillView | null>(null)

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

  if (selectedSkill) {
    return (
      <SkillDetail
        skill={selectedSkill}
        onBack={() => setSelectedSkill(null)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <WrenchIcon className="size-5" />
          <h1 className="text-lg font-semibold">技能管理</h1>
          <Badge variant="secondary" className="text-xs">
            {skills.length} 个技能
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={loadSkills} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <WrenchIcon className="size-12 opacity-20" />
            <div className="text-center max-w-md space-y-1">
              <p className="text-sm font-medium">暂无技能</p>
              <p className="text-xs">
                在 .thething/skills/ 目录下创建 {`{skillName}/SKILL.md`} 文件来定义新技能
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {skills.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                onClick={() => setSelectedSkill(skill)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Skill Detail — 技能详情视图（目录树 + 文件预览分栏）
// ============================================================

interface SkillDetailProps {
  skill: SkillView
  onBack: () => void
}

function SkillDetail({ skill, onBack }: SkillDetailProps) {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [showTree, setShowTree] = useState(true)
  const [showPreview, setShowPreview] = useState(true)

  // 进入详情时自动选中 SKILL.md
  useEffect(() => {
    setSelectedFilePath(`${skill.sourcePath}/SKILL.md`)
    setShowTree(true)
    setShowPreview(true)
  }, [skill.sourcePath])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
            返回
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <WrenchIcon className="size-5 shrink-0" />
            <h1 className="text-lg font-semibold truncate">{skill.name}</h1>
            {skill.source && (
              <Badge variant="outline" className="text-xs shrink-0">{skill.source}</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTree(!showTree)}
            className={cn(showTree && "bg-accent")}
          >
            <PanelLeftOpenIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className={cn(showPreview && "bg-accent")}
          >
            <PanelRightOpenIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Skill Info Bar */}
      <div className="flex items-center gap-3 px-6 py-2 border-b bg-muted/20 text-xs text-muted-foreground">
        <Badge className={`text-xs border-0 ${effortColors[skill.effort] ?? effortColors.medium}`}>
          {effortLabels[skill.effort] ?? skill.effort}
        </Badge>
        {skill.model && (
          <Badge variant="outline" className="text-xs font-mono">
            <TagIcon className="size-3 mr-0.5" />
            {skill.model}
          </Badge>
        )}
        {skill.allowedTools.length > 0 && (
          <span className="flex items-center gap-1">
            <LayersIcon className="size-3" />
            {skill.allowedTools.length} 个工具
          </span>
        )}
        {skill.whenToUse && (
          <span className="flex items-center gap-1 truncate max-w-96" title={skill.whenToUse}>
            <TargetIcon className="size-3 shrink-0" />
            <span className="truncate">{skill.whenToUse}</span>
          </span>
        )}
      </div>

      {/* Split view: Tree + Preview */}
      <div className="flex-1 flex overflow-hidden">
        {showTree && (
          <div className="w-72 border-r overflow-hidden flex flex-col shrink-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FolderIcon className="size-3.5" />
                <span className="truncate max-w-48" title={skill.sourcePath}>
                  {skill.sourcePath.split('/').pop() || skill.sourcePath}
                </span>
              </div>
            </div>
            <DirectoryTree
              rootPath={skill.sourcePath}
              selectedFile={selectedFilePath}
              onFileSelect={setSelectedFilePath}
              className="flex-1 py-1"
            />
          </div>
        )}

        {showPreview && (
          <div className="flex-1 overflow-hidden p-4">
            <FilePreview
              filePath={selectedFilePath}
              className="h-full"
              minHeight={400}
            />
          </div>
        )}

        {!showTree && !showPreview && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/40 text-sm">
            <div className="text-center space-y-2">
              <InfoIcon className="size-8 mx-auto opacity-30" />
              <p>使用顶栏按钮切换面板显示</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// SkillCard — 技能列表卡片
// ============================================================

function SkillCard({ skill, onClick }: { skill: SkillView; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border p-4 space-y-3 w-full text-left hover:border-accent/50 hover:bg-accent/20 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <WrenchIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{skill.name}</span>
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
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <FolderIcon className="size-3" />
          <span className="truncate max-w-64" title={skill.sourcePath}>
            {skill.sourcePath}
          </span>
        </div>
        <span className="text-muted-foreground/40">|</span>
        <div className="flex items-center gap-1">
          <LayersIcon className="size-3" />
          <span>{skill.allowedTools.length} 个工具</span>
        </div>
        <span className="text-muted-foreground/40">|</span>
        <Badge variant="outline" className="text-xs">
          {skill.source}
        </Badge>
      </div>
    </button>
  )
}
