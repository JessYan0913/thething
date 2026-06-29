import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  KeyRoundIcon,
  GlobeIcon,
  SaveIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
  ZapIcon,
  BrainIcon,
  SparklesIcon,
  AlertCircleIcon,
  DownloadIcon,
  SearchIcon,
  CheckIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { type ModelAliases } from "@the-thing/core"

interface Config {
  apiKey: string
  baseURL: string
}

interface ModelInfo {
  id: string
  name: string
  owned_by?: string
}

type AliasType = "fast" | "smart" | "default"

const PROVIDERS = [
  { id: "openai", baseURL: "https://api.openai.com/v1" },
  { id: "openrouter", baseURL: "https://openrouter.ai/api/v1" },
  { id: "deepseek", baseURL: "https://api.deepseek.com" },
  { id: "moonshot", baseURL: "https://api.moonshot.cn/v1" },
  { id: "qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "glm", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "doubao", baseURL: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "custom", baseURL: "" },
]

function detectProvider(baseURL: string): string {
  if (!baseURL) return "custom"
  const normalized = baseURL.replace(/\/+$/, "")
  for (const p of PROVIDERS) {
    if (p.baseURL && normalized.startsWith(p.baseURL.replace(/\/+$/, ""))) {
      return p.id
    }
  }
  return "custom"
}

export default function ModelSettings() {
  const { t } = useTranslation("settings")
  const [config, setConfig] = useState<Config>({ apiKey: "", baseURL: "" })
  const [aliases, setAliases] = useState<ModelAliases>({
    fast: { model: "" },
    smart: { model: "" },
    default: { model: "" },
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle")
  const [errors, setErrors] = useState<{ default?: string }>({})

  const [selectedProvider, setSelectedProvider] = useState("custom")

  // 模型列表相关状态
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [isModelsDialogOpen, setIsModelsDialogOpen] = useState(false)
  const [selectingAlias, setSelectingAlias] = useState<AliasType | null>(null)
  const [modelSearch, setModelSearch] = useState("")

  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/config")
      if (res.ok) {
        const data = await res.json()
        const baseURL = data.baseURL || ""
        setConfig({ apiKey: data.apiKey, baseURL })
        setSelectedProvider(detectProvider(baseURL))
        setAliases({
          fast: { model: data.modelAliases?.fast?.model || "", contextLimit: data.modelAliases?.fast?.contextLimit },
          smart: { model: data.modelAliases?.smart?.model || "", contextLimit: data.modelAliases?.smart?.contextLimit },
          default: { model: data.modelAliases?.default?.model || "", contextLimit: data.modelAliases?.default?.contextLimit },
        })
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

  const validate = useCallback((): boolean => {
    const newErrors: { default?: string } = {}
    if (!aliases.default.model.trim()) {
      newErrors.default = t("models.alias.defaultRequired")
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [aliases.default.model, t])

  const handleSave = useCallback(async () => {
    if (!validate()) return

    setIsSaving(true)
    setSaveStatus("idle")
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, modelAliases: aliases }),
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
  }, [config, aliases, validate])

  const updateField = useCallback((field: keyof Config, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
    setSaveStatus("idle")
  }, [])

  const updateAlias = useCallback((field: keyof ModelAliases, value: string) => {
    setAliases((prev) => ({ ...prev, [field]: { ...prev[field], model: value } }))
    setSaveStatus("idle")
    if (field === "default" && errors.default) {
      setErrors((prev) => ({ ...prev, default: undefined }))
    }
  }, [errors.default])

  const updateContextLimit = useCallback((alias: "fast" | "smart" | "default", value: number | undefined) => {
    setAliases((prev) => ({
      ...prev,
      [alias]: { ...prev[alias], contextLimit: value }
    }))
    setSaveStatus("idle")
  }, [])

  const fetchModels = useCallback(async () => {
    if (!config.baseURL) {
      setModelsError(t("models.fetchModels.baseURLRequired"))
      return
    }

    setIsFetchingModels(true)
    setModelsError(null)
    setModels([])

    try {
      const params = new URLSearchParams()
      if (config.baseURL) params.set("baseURL", config.baseURL)
      if (config.apiKey) params.set("apiKey", config.apiKey)

      const res = await fetch(`/api/models?${params.toString()}`)
      const data = await res.json()

      if (!res.ok) {
        setModelsError(data.error || t("models.fetchModels.error"))
        return
      }

      setModels(data.models || [])
      if (data.models?.length === 0) {
        setModelsError(t("models.fetchModels.noModels"))
      }
    } catch {
      setModelsError(t("models.fetchModels.error"))
    } finally {
      setIsFetchingModels(false)
    }
  }, [config.baseURL, config.apiKey, t])

  const handleOpenModelsDialog = useCallback((alias: AliasType) => {
    setSelectingAlias(alias)
    setModelSearch("")
    setIsModelsDialogOpen(true)
    if (models.length === 0) {
      fetchModels()
    }
  }, [models.length, fetchModels])

  const handleSelectModel = useCallback((modelId: string) => {
    if (selectingAlias) {
      updateAlias(selectingAlias, modelId)
    }
    setIsModelsDialogOpen(false)
    setSelectingAlias(null)
  }, [selectingAlias, updateAlias])

  const filteredModels = models.filter((model) =>
    model.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
    model.name.toLowerCase().includes(modelSearch.toLowerCase())
  )

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
              <div className="shrink-0 flex items-center gap-2">
                <Select
                  value={selectedProvider}
                  onValueChange={(value) => {
                    setSelectedProvider(value)
                    const provider = PROVIDERS.find((p) => p.id === value)
                    if (provider) {
                      updateField("baseURL", provider.baseURL)
                    }
                  }}
                >
                  <SelectTrigger className="w-28 text-xs">
                    <SelectValue placeholder="..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs cursor-pointer">
                        {t(`models.provider.${p.id}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  value={config.baseURL}
                  onChange={(e) => updateField("baseURL", e.target.value)}
                  placeholder={t("models.baseURL.placeholder")}
                  className="font-mono text-xs w-64"
                  disabled={isLoading}
                />
              </div>
            </div>

            <Separator />

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

            {/* Model Aliases Section */}
            <div className="px-4 py-2 border-t border-b bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground">
                {t("models.aliasSection")}
              </span>
            </div>

            <div className="px-4 py-4 space-y-3">
              {/* Default Model - Required */}
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                  <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <SparklesIcon className="size-3.5 text-green-500" />
                  </div>
                  <span className="text-sm font-medium flex-1 min-w-0">{t("models.alias.default")}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {t("models.alias.required")}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenModelsDialog("default")}
                    disabled={!config.baseURL || !config.apiKey}
                    className="h-7 text-xs"
                  >
                    <DownloadIcon className="size-3.5 mr-1" />
                    {t("models.fetchModels.button")}
                  </Button>
                </div>
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <Input
                    type="text"
                    value={aliases.default.model}
                    onChange={(e) => updateAlias("default", e.target.value)}
                    placeholder="e.g. gpt-4o, qwen-plus"
                    className={`flex-1 font-mono text-sm ${errors.default ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                    disabled={isLoading}
                  />
                  <div className="shrink-0 flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Context:</label>
                    <Input
                      type="number"
                      value={aliases.default.contextLimit ?? ""}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : undefined
                        updateContextLimit("default", val)
                      }}
                      placeholder="128000"
                      className="font-mono text-xs w-24"
                      min={0}
                      disabled={isLoading}
                    />
                  </div>
                </div>
                {errors.default && (
                  <div className="flex items-center gap-1.5 text-xs text-red-500 px-4 pb-2.5">
                    <AlertCircleIcon className="size-3.5" />
                    <span>{errors.default}</span>
                  </div>
                )}
              </div>

              {/* Fast Model */}
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                  <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <ZapIcon className="size-3.5 text-yellow-500" />
                  </div>
                  <span className="text-sm font-medium flex-1 min-w-0">{t("models.alias.fast")}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {t("models.alias.fastDescription")}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenModelsDialog("fast")}
                    disabled={!config.baseURL || !config.apiKey}
                    className="h-7 text-xs"
                  >
                    <DownloadIcon className="size-3.5 mr-1" />
                    {t("models.fetchModels.button")}
                  </Button>
                </div>
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <Input
                    type="text"
                    value={aliases.fast.model}
                    onChange={(e) => updateAlias("fast", e.target.value)}
                    placeholder="e.g. gpt-4o-mini"
                    className="flex-1 font-mono text-sm"
                    disabled={isLoading}
                  />
                  <div className="shrink-0 flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Context:</label>
                    <Input
                      type="number"
                      value={aliases.fast.contextLimit ?? ""}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : undefined
                        updateContextLimit("fast", val)
                      }}
                      placeholder="128000"
                      className="font-mono text-xs w-24"
                      min={0}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>

              {/* Smart Model */}
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                  <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <BrainIcon className="size-3.5 text-blue-500" />
                  </div>
                  <span className="text-sm font-medium flex-1 min-w-0">{t("models.alias.smart")}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {t("models.alias.smartDescription")}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenModelsDialog("smart")}
                    disabled={!config.baseURL || !config.apiKey}
                    className="h-7 text-xs"
                  >
                    <DownloadIcon className="size-3.5 mr-1" />
                    {t("models.fetchModels.button")}
                  </Button>
                </div>
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <Input
                    type="text"
                    value={aliases.smart.model}
                    onChange={(e) => updateAlias("smart", e.target.value)}
                    placeholder="e.g. gpt-4o"
                    className="flex-1 font-mono text-sm"
                    disabled={isLoading}
                  />
                  <div className="shrink-0 flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Context:</label>
                    <Input
                      type="number"
                      value={aliases.smart.contextLimit ?? ""}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : undefined
                        updateContextLimit("smart", val)
                      }}
                      placeholder="200000"
                      className="font-mono text-xs w-24"
                      min={0}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Model Selection Dialog */}
      <Dialog open={isModelsDialogOpen} onOpenChange={setIsModelsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("models.fetchModels.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("models.fetchModels.dialogDescription", {
                alias: selectingAlias ? t(`models.alias.${selectingAlias}`) : ""
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder={t("models.fetchModels.searchPlaceholder")}
                className="pl-9"
              />
            </div>

            {/* Fetch Button */}
            <Button
              variant="outline"
              onClick={fetchModels}
              disabled={isFetchingModels || !config.baseURL || !config.apiKey}
              className="w-full"
            >
              {isFetchingModels ? (
                <>
                  <RefreshCwIcon className="size-4 mr-2 animate-spin" />
                  {t("models.fetchModels.fetching")}
                </>
              ) : (
                <>
                  <DownloadIcon className="size-4 mr-2" />
                  {t("models.fetchModels.fetchButton")}
                </>
              )}
            </Button>

            {/* Error */}
            {modelsError && (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircleIcon className="size-4" />
                <span>{modelsError}</span>
              </div>
            )}

            {/* Model List */}
            <div className="border rounded-lg max-h-64 overflow-auto">
              {filteredModels.length > 0 ? (
                <div className="divide-y">
                  {filteredModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => handleSelectModel(model.id)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm truncate">{model.id}</div>
                        {model.owned_by && (
                          <div className="text-xs text-muted-foreground truncate">
                            {model.owned_by}
                          </div>
                        )}
                      </div>
                      {aliases[selectingAlias || "default"].model === model.id && (
                        <CheckIcon className="size-4 text-green-500 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {isFetchingModels ? t("models.fetchModels.loading") : t("models.fetchModels.noModels")}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
