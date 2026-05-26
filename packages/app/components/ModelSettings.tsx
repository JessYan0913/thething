import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  KeyRoundIcon,
  GlobeIcon,
  CpuIcon,
  SaveIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
  ZapIcon,
  BrainIcon,
  SparklesIcon,
  InfoIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"

interface ModelConfig {
  apiKey: string
  baseURL: string
  model: string
}

const DEFAULT_ALIASES = {
  fast: "qwen-turbo",
  smart: "qwen-max",
  default: "qwen-plus",
}

export default function ModelSettings() {
  const { t } = useTranslation("settings")
  const [config, setConfig] = useState<ModelConfig>({ apiKey: "", baseURL: "", model: "" })
  const [showApiKey, setShowApiKey] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle")

  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/config")
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config)
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setSaveStatus("idle")
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setSaveStatus("success")
        setTimeout(() => setSaveStatus("idle"), 2000)
      } else {
        setSaveStatus("error")
      }
    } catch {
      setSaveStatus("error")
    } finally {
      setIsSaving(false)
    }
  }, [config])

  const updateField = useCallback((field: keyof ModelConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
    setSaveStatus("idle")
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {t("models.badge")}
          </Badge>
          {saveStatus === "success" && (
            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25 text-xs">
              {t("models.saved")}
            </Badge>
          )}
          {saveStatus === "error" && (
            <Badge variant="destructive" className="text-xs">
              {t("models.saveError")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadConfig} disabled={isLoading}>
            <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || isLoading}>
            <SaveIcon className="size-4" />
            {t("models.save")}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="flex justify-center px-6 py-6">
          <div className="w-full max-w-2xl rounded-lg border">
            {/* Provider Configuration */}
            <div className="px-4 py-2 border-b bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground">
                {t("models.providerSection")}
              </span>
            </div>

            {/* API Key */}
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <KeyRoundIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-medium">{t("models.apiKey.title")}</span>
                  <p className="text-xs text-muted-foreground truncate">
                    {t("models.apiKey.description")}
                  </p>
                </div>
              </div>
              <div className="shrink-0 relative w-64">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={config.apiKey}
                  onChange={(e) => updateField("apiKey", e.target.value)}
                  placeholder={t("models.apiKey.placeholder")}
                  className="pr-8 font-mono text-xs"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showApiKey ? (
                    <EyeOffIcon className="size-3.5" />
                  ) : (
                    <EyeIcon className="size-3.5" />
                  )}
                </button>
              </div>
            </div>

            <Separator />

            {/* Base URL */}
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <GlobeIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-medium">{t("models.baseURL.title")}</span>
                  <p className="text-xs text-muted-foreground truncate">
                    {t("models.baseURL.description")}
                  </p>
                </div>
              </div>
              <div className="shrink-0 w-64">
                <Input
                  type="text"
                  value={config.baseURL}
                  onChange={(e) => updateField("baseURL", e.target.value)}
                  placeholder={t("models.baseURL.placeholder")}
                  className="font-mono text-xs"
                  disabled={isLoading}
                />
              </div>
            </div>

            <Separator />

            {/* Model Name */}
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <CpuIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-medium">{t("models.model.title")}</span>
                  <p className="text-xs text-muted-foreground truncate">
                    {t("models.model.description")}
                  </p>
                </div>
              </div>
              <div className="shrink-0 w-64">
                <Input
                  type="text"
                  value={config.model}
                  onChange={(e) => updateField("model", e.target.value)}
                  placeholder={t("models.model.placeholder")}
                  className="font-mono text-xs"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Model Aliases Section */}
            <div className="px-4 py-2 border-t border-b bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground">
                {t("models.aliasSection")}
              </span>
            </div>

            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <InfoIcon className="size-3.5" />
                <span>{t("models.aliasHint")}</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2 rounded-md border p-2.5">
                  <ZapIcon className="size-3.5 text-yellow-500" />
                  <div className="min-w-0">
                    <span className="text-xs font-medium">{t("models.alias.fast")}</span>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {DEFAULT_ALIASES.fast}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-md border p-2.5">
                  <BrainIcon className="size-3.5 text-blue-500" />
                  <div className="min-w-0">
                    <span className="text-xs font-medium">{t("models.alias.smart")}</span>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {DEFAULT_ALIASES.smart}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-md border p-2.5">
                  <SparklesIcon className="size-3.5 text-green-500" />
                  <div className="min-w-0">
                    <span className="text-xs font-medium">{t("models.alias.default")}</span>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {DEFAULT_ALIASES.default}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
