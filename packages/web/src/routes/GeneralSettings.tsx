import { useState } from "react"
import { useTheme } from "next-themes"
import {
  PaletteIcon,
  LanguagesIcon,
  CheckIcon,
  ChevronDownIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

// ============================================================
// SettingRow — 通用设置行：左侧图标+标题+描述，右侧控件
// ============================================================

interface SettingRowProps {
  icon: React.ReactNode
  title: string
  description?: string
  badge?: React.ReactNode
  children: React.ReactNode
}

function SettingRow({ icon, title, description, badge, children }: SettingRowProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{title}</span>
            {badge}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {children}
      </div>
    </div>
  )
}

// ============================================================
// ThemeSelect — 主题下拉选择器
// ============================================================

const themeOptions = [
  { value: "light", label: "浅色", emoji: "☀️" },
  { value: "dark", label: "深色", emoji: "🌙" },
  { value: "system", label: "跟随系统", emoji: "💻" },
]

function ThemeSelect() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const current = themeOptions.find((o) => o.value === theme) ?? themeOptions[2]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors min-w-[110px]",
          open && "bg-accent",
        )}
      >
        <span>{current.emoji}</span>
        <span>{current.label}</span>
        <ChevronDownIcon className={cn("size-3.5 ml-auto transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border bg-popover shadow-md">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent transition-colors first:rounded-t-md last:rounded-b-md",
                  theme === opt.value && "bg-accent/50",
                )}
                onClick={() => {
                  setTheme(opt.value)
                  setOpen(false)
                }}
              >
                <span>{opt.emoji}</span>
                <span className="flex-1 text-left">{opt.label}</span>
                {theme === opt.value && <CheckIcon className="size-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// LanguageSelect — 语言下拉选择器（禁用）
// ============================================================

const languageOptions = [
  { value: "zh-CN", label: "简体中文", emoji: "🇨🇳" },
  { value: "en", label: "English", emoji: "🇬🇧" },
]

function LanguageSelect() {
  const [language] = useState("zh-CN")
  const current = languageOptions.find((o) => o.value === language) ?? languageOptions[0]

  return (
    <div className="relative">
      <button
        disabled
        className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm cursor-not-allowed opacity-40 min-w-[110px]"
      >
        <span>{current.emoji}</span>
        <span>{current.label}</span>
        <ChevronDownIcon className="size-3.5 ml-auto" />
      </button>
    </div>
  )
}

// ============================================================
// GeneralSettings — 通用设置页面
// ============================================================

export default function GeneralSettings() {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="flex justify-center px-6 py-6">
          <div className="w-full max-w-2xl rounded-lg border">
          {/* Appearance */}
          <div className="px-4 py-2 border-b bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Appearance</span>
          </div>
          <SettingRow
            icon={<PaletteIcon className="size-4" />}
            title="Theme"
            description="Select the theme for the app interface"
          >
            <ThemeSelect />
          </SettingRow>

          <Separator />

          {/* Language */}
          <div className="px-4 py-2 border-b bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Language</span>
          </div>
          <SettingRow
            icon={<LanguagesIcon className="size-4" />}
            title="Language"
            description="Select the display language for the app"
            badge={<Badge variant="secondary" className="text-[10px] px-1.5 py-0">未开放</Badge>}
          >
            <LanguageSelect />
          </SettingRow>
          </div>
        </div>
      </div>
    </div>
  )
}
