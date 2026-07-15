import { useCallback, useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { useTranslation } from "react-i18next"
import {
  PaletteIcon,
  LanguagesIcon,
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  SaveIcon,
  RefreshCwIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

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

function ThemeSelect() {
  const { t } = useTranslation('settings')
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const themeOptions = [
    { value: "light", label: t('general.theme.light'), emoji: "☀️" },
    { value: "dark", label: t('general.theme.dark'), emoji: "🌙" },
    { value: "system", label: t('general.theme.system'), emoji: "💻" },
  ]
  const current = themeOptions.find((o) => o.value === theme) ?? themeOptions[2]

  // Avoid hydration mismatch: server and first client render must match
  if (!mounted) {
    return (
      <div className="relative">
        <button className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm min-w-[110px] opacity-0">
          <span>{current.emoji}</span>
          <span>{current.label}</span>
        </button>
      </div>
    )
  }

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
// LanguageSelect — 语言下拉选择器
// ============================================================

function LanguageSelect() {
  const { t, i18n } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const languageOptions = [
    { value: "zh-CN", label: t('general.languageSection.options.zhCN'), emoji: "🇨🇳" },
    { value: "en", label: t('general.languageSection.options.en'), emoji: "🇬🇧" },
    { value: "ja", label: t('general.languageSection.options.ja'), emoji: "🇯🇵" },
  ]
  const current = languageOptions.find((o) => o.value === i18n.language) ?? languageOptions[0]

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
            {languageOptions.map((opt) => (
              <button
                key={opt.value}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent transition-colors first:rounded-t-md last:rounded-b-md",
                  i18n.language === opt.value && "bg-accent/50",
                )}
                onClick={() => {
                  i18n.changeLanguage(opt.value)
                  setOpen(false)
                }}
              >
                <span>{opt.emoji}</span>
                <span className="flex-1 text-left">{opt.label}</span>
                {i18n.language === opt.value && <CheckIcon className="size-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// DataDirSetting — 运行时数据目录
// 路径保存在 ~/.thethingrc，这是一个固定位置的启动指针文件。
// ============================================================

function DataDirSetting() {
  const [dataDir, setDataDir] = useState('')
  const [origDataDir, setOrigDataDir] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const loadDataDir = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/thethingrc')
      if (res.ok) {
        const data = await res.json()
        setDataDir(data.dataDir || '')
        setOrigDataDir(data.dataDir || '')
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDataDir()
  }, [loadDataDir])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch('/api/thethingrc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataDir: dataDir.trim() }),
      })
      if (res.ok) {
        setOrigDataDir(dataDir.trim())
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    } finally {
      setIsSaving(false)
    }
  }, [dataDir])

  const hasChanged = dataDir !== origDataDir

  return (
    <>
      <Separator />
      <div className="px-4 py-2 border-b bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">
          运行时数据
        </span>
      </div>
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
            <FolderIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium">数据目录</span>
            <p className="text-xs text-muted-foreground truncate">
              数据库、连接器、权限规则等运行时数据的存储位置。留空则默认 ~/.thething
            </p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <div className="relative">
            <Input
              type="text"
              value={dataDir}
              onChange={(e) => setDataDir(e.target.value)}
              className="font-mono text-xs w-72 pr-6"
              disabled={isLoading}
              placeholder="~/.thething"
            />
            {saveStatus === 'success' && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-green-500 text-xs">✓</span>
            )}
            {saveStatus === 'error' && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-red-500 text-xs">✗</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadDataDir}
            disabled={isLoading}
            className="h-8 w-8 p-0"
          >
            <RefreshCwIcon className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          {hasChanged && (
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              <SaveIcon className="size-3.5 mr-1" />
              保存
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

// ============================================================
// GeneralSettings — 通用设置页面
// ============================================================

export default function GeneralSettings() {
  const { t } = useTranslation('settings')

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="flex justify-center px-6 py-6">
          <div className="w-full max-w-2xl rounded-lg border">
          {/* Appearance */}
          <div className="px-4 py-2 border-b bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">{t('general.appearance')}</span>
          </div>
          <SettingRow
            icon={<PaletteIcon className="size-4" />}
            title={t('general.theme.title')}
            description={t('general.theme.description')}
          >
            <ThemeSelect />
          </SettingRow>

          <Separator />

          {/* Language */}
          <div className="px-4 py-2 border-b bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">{t('general.language')}</span>
          </div>
          <SettingRow
            icon={<LanguagesIcon className="size-4" />}
            title={t('general.languageSection.title')}
            description={t('general.languageSection.description')}
          >
            <LanguageSelect />
          </SettingRow>

          <DataDirSetting />
          </div>
        </div>
      </div>
    </div>
  )
}
