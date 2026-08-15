import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  RefreshCwIcon,
  AlertCircleIcon,
  DownloadIcon,
  SearchIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  EyeIcon,
  EyeOffIcon,
  ZapIcon,
  MessageSquareIcon,
  ServerIcon,
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
import { Badge } from "@/components/ui/badge"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ProviderModel {
  id: string
  contextLimit?: number
  outputTokens?: number
}

interface ProviderEntry {
  name: string
  baseURL: string
  apiKey: string
  models: ProviderModel[]
}

interface ModelInfo {
  id: string
  name: string
  owned_by?: string
}

const PROVIDER_PRESETS = [
  { id: "openai", baseURL: "https://api.openai.com/v1" },
  { id: "openrouter", baseURL: "https://openrouter.ai/api/v1" },
  { id: "deepseek", baseURL: "https://api.deepseek.com" },
  { id: "moonshot", baseURL: "https://api.moonshot.cn/v1" },
  { id: "qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "glm", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "doubao", baseURL: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "custom", baseURL: "" },
]

function detectPreset(baseURL: string): string {
  if (!baseURL) return "custom"
  const normalized = baseURL.replace(/\/+$/, "")
  for (const p of PROVIDER_PRESETS) {
    if (p.baseURL && normalized.startsWith(p.baseURL.replace(/\/+$/, ""))) {
      return p.id
    }
  }
  return "custom"
}

/** 供应商显示名回落链:自定义名 → 预设供应商名 → 域名 */
function providerDisplayName(provider: { name: string; baseURL: string }, t: (key: string) => string): string {
  if (provider.name.trim()) return provider.name
  const preset = detectPreset(provider.baseURL)
  if (preset !== "custom") return t(`models.provider.${preset}`)
  try {
    return new URL(provider.baseURL).hostname
  } catch {
    return provider.baseURL
  }
}

/** 供应商编辑弹窗状态。index=null 表示新增 */
interface ProviderEditState {
  index: number | null
  /** 第一行选择的供应商:预设 id 或 "custom" */
  preset: string
  provider: Omit<ProviderEntry, "models">
}

/** 添加模型弹窗状态(挂在某个供应商下) */
interface ModelAddState {
  providerIndex: number
  /** 编辑已有模型时为原 id,新增为 null */
  editingId: string | null
  id: string
  contextLimit?: number
  outputTokens?: number
}

export default function ModelSettings() {
  const { t } = useTranslation("settings")
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [defaultModel, setDefaultModel] = useState("")
  const [backgroundModel, setBackgroundModel] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle")

  // 供应商编辑弹窗
  const [providerEdit, setProviderEdit] = useState<ProviderEditState | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  // 删除二次确认(供应商或模型)
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: "provider"; providerIndex: number; label: string }
    | { kind: "model"; providerIndex: number; modelId: string; label: string }
    | null
  >(null)

  // 添加/编辑模型弹窗
  const [modelAdd, setModelAdd] = useState<ModelAddState | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [modelSearch, setModelSearch] = useState("")

  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/config")
      if (res.ok) {
        const data = await res.json()
        setProviders(Array.isArray(data.providers) ? data.providers : [])
        setDefaultModel(data.defaultModel || "")
        setBackgroundModel(data.backgroundModel || "")
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

  const persist = useCallback(async (nextProviders: ProviderEntry[], nextDefault: string, nextBackground: string) => {
    setIsSaving(true)
    setSaveStatus("idle")
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: nextProviders,
          defaultModel: nextDefault,
          backgroundModel: nextBackground || undefined,
        }),
      })
      setSaveStatus(res.ok ? "success" : "error")
      if (res.ok) setTimeout(() => setSaveStatus("idle"), 2000)
    } catch {
      setSaveStatus("error")
    } finally {
      setIsSaving(false)
    }
  }, [])

  const applyChange = useCallback((nextProviders: ProviderEntry[], nextDefault: string, nextBackground: string) => {
    const ids = new Set(nextProviders.flatMap(p => p.models.map(m => m.id)))
    const firstId = nextProviders.flatMap(p => p.models)[0]?.id ?? ""
    const resolvedDefault = ids.has(nextDefault) ? nextDefault : firstId
    const resolvedBackground = ids.has(nextBackground) ? nextBackground : ""
    setProviders(nextProviders)
    setDefaultModel(resolvedDefault)
    setBackgroundModel(resolvedBackground)
    persist(nextProviders, resolvedDefault, resolvedBackground)
  }, [persist])

  // ── 弹窗内拉取供应商模型列表 ──────────────────────────

  // 用显式凭据拉取(供应商刚保存时 state 尚未回流,不能依赖 providers[index])
  const fetchModelsWith = useCallback(async (baseURL: string, apiKey: string) => {
    if (!baseURL) return
    setIsFetchingModels(true)
    setFetchError(null)
    setFetchedModels([])
    try {
      const params = new URLSearchParams()
      params.set("baseURL", baseURL)
      if (apiKey) params.set("apiKey", apiKey)
      const res = await fetch(`/api/models?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setFetchError(data.error || t("models.fetchModels.error"))
        return
      }
      setFetchedModels(data.models || [])
      if (data.models?.length === 0) {
        setFetchError(t("models.fetchModels.noModels"))
      }
    } catch {
      setFetchError(t("models.fetchModels.error"))
    } finally {
      setIsFetchingModels(false)
    }
  }, [t])

  const openAddModel = useCallback((providerIndex: number, credentials?: { baseURL: string; apiKey: string }) => {
    setModelAdd({ providerIndex, editingId: null, id: "" })
    setModelError(null)
    setFetchedModels([])
    setFetchError(null)
    setModelSearch("")
    // 打开即自动拉取模型列表,免去用户再点一次"获取"
    const cred = credentials ?? providers[providerIndex]
    if (cred?.baseURL) {
      fetchModelsWith(cred.baseURL, cred.apiKey)
    }
  }, [providers, fetchModelsWith])

  // ── 供应商增删改 ──────────────────────────────────────

  const openAddProvider = useCallback(() => {
    setProviderEdit({ index: null, preset: "custom", provider: { name: "", baseURL: "", apiKey: "" } })
    setProviderError(null)
    setShowApiKey(false)
  }, [])

  const openEditProvider = useCallback((index: number) => {
    const { models: _m, ...rest } = providers[index]
    // 无自定义名且 baseURL 命中预设 → 预设模式;否则自定义模式
    const detected = detectPreset(rest.baseURL)
    const preset = !rest.name.trim() && detected !== "custom" ? detected : "custom"
    setProviderEdit({ index, preset, provider: { ...rest } })
    setProviderError(null)
    setShowApiKey(false)
  }, [providers])

  const updateProviderField = useCallback((patch: Partial<Omit<ProviderEntry, "models">>) => {
    setProviderEdit(prev => prev ? { ...prev, provider: { ...prev.provider, ...patch } } : prev)
    setProviderError(null)
  }, [])

  const handleSaveProvider = useCallback(async () => {
    if (!providerEdit || isVerifying) return
    const { index, provider } = providerEdit
    if (!provider.baseURL.trim() || !provider.apiKey.trim()) {
      setProviderError(t("models.providerEdit.requiredError"))
      return
    }
    const normalized = {
      name: provider.name.trim(),
      baseURL: provider.baseURL.trim(),
      apiKey: provider.apiKey.trim(),
    }
    // 保存前校验凭据有效性:请求 /v1/models 探活(供应商无效时立刻暴露,
    // 而不是等第一次对话失败)
    setIsVerifying(true)
    setProviderError(null)
    try {
      const params = new URLSearchParams()
      params.set("baseURL", normalized.baseURL)
      params.set("apiKey", normalized.apiKey)
      const res = await fetch(`/api/models?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setProviderError(t("models.providerEdit.verifyError", { status: data.error || res.status }))
        return
      }
    } catch {
      setProviderError(t("models.providerEdit.verifyNetworkError"))
      return
    } finally {
      setIsVerifying(false)
    }

    const next = [...providers]
    if (index === null) {
      next.push({ ...normalized, models: [] })
    } else {
      next[index] = { ...next[index], ...normalized }
    }
    applyChange(next, defaultModel, backgroundModel)
    setProviderEdit(null)
    // 新增供应商 → 顺势打开添加模型弹窗(下一步必然是加模型,自动衔接)
    if (index === null) {
      openAddModel(next.length - 1, normalized)
    }
  }, [providerEdit, isVerifying, providers, defaultModel, backgroundModel, applyChange, openAddModel, t])

  const handleDeleteProvider = useCallback((index: number) => {
    const next = providers.filter((_, i) => i !== index)
    applyChange(next, defaultModel, backgroundModel)
  }, [providers, defaultModel, backgroundModel, applyChange])

  const handleDeleteModel = useCallback((providerIndex: number, modelId: string) => {
    const next = providers.map((p, pi) =>
      pi === providerIndex ? { ...p, models: p.models.filter(m => m.id !== modelId) } : p)
    applyChange(next, defaultModel, backgroundModel)
  }, [providers, defaultModel, backgroundModel, applyChange])

  const handleConfirmDelete = useCallback(() => {
    if (!deleteConfirm) return
    if (deleteConfirm.kind === "provider") {
      handleDeleteProvider(deleteConfirm.providerIndex)
    } else {
      handleDeleteModel(deleteConfirm.providerIndex, deleteConfirm.modelId)
    }
    setDeleteConfirm(null)
  }, [deleteConfirm, handleDeleteProvider, handleDeleteModel])

  const fetchModels = useCallback(async () => {
    if (!modelAdd) return
    const provider = providers[modelAdd.providerIndex]
    if (!provider?.baseURL) return
    await fetchModelsWith(provider.baseURL, provider.apiKey)
  }, [modelAdd, providers, fetchModelsWith])

  // ── 模型增删(供应商卡片内) ──────────────────────────

  const openEditModel = useCallback((providerIndex: number, model: ProviderModel) => {
    setModelAdd({ providerIndex, editingId: model.id, id: model.id, contextLimit: model.contextLimit, outputTokens: model.outputTokens })
    setModelError(null)
    setFetchedModels([])
    setFetchError(null)
    setModelSearch("")
  }, [])

  /**
   * 保存模型。keepOpen=true("保存并继续添加")时保留弹窗与已拉取的模型列表,
   * 清空输入继续加下一个。
   */
  const handleSaveModel = useCallback((keepOpen = false) => {
    if (!modelAdd) return
    const id = modelAdd.id.trim()
    if (!id) {
      setModelError(t("models.modelEdit.requiredError"))
      return
    }
    // 全局重名检查(排除正在编辑的这条)
    const duplicate = providers.some((p, pi) =>
      p.models.some(m => m.id === id && !(pi === modelAdd.providerIndex && m.id === modelAdd.editingId)))
    if (duplicate) {
      setModelError(t("models.modelEdit.duplicateError"))
      return
    }
    const next = providers.map((p, pi) => {
      if (pi !== modelAdd.providerIndex) return p
      const entry: ProviderModel = {
        id,
        ...(modelAdd.contextLimit ? { contextLimit: Number(modelAdd.contextLimit) } : {}),
        ...(modelAdd.outputTokens ? { outputTokens: Number(modelAdd.outputTokens) } : {}),
      }
      const models = modelAdd.editingId
        ? p.models.map(m => m.id === modelAdd.editingId ? entry : m)
        : [...p.models, entry]
      return { ...p, models }
    })
    // 改名时同步两个单选标记
    const oldId = modelAdd.editingId
    applyChange(
      next,
      oldId && defaultModel === oldId ? id : defaultModel,
      oldId && backgroundModel === oldId ? id : backgroundModel,
    )
    if (keepOpen) {
      setModelAdd(prev => prev ? { ...prev, editingId: null, id: "", contextLimit: undefined, outputTokens: undefined } : prev)
    } else {
      setModelAdd(null)
    }
  }, [modelAdd, providers, defaultModel, backgroundModel, applyChange, t])

  const filteredModels = fetchedModels.filter((model) =>
    model.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
    model.name.toLowerCase().includes(modelSearch.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b bg-muted/30">
        <div className="flex-1 flex items-center gap-2">
          {isSaving && (
            <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{t("models.saving")}</Badge>
          )}
          {saveStatus === "success" && (
            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25 text-[10px] px-1.5 h-4">
              {t("models.saved")}
            </Badge>
          )}
          {saveStatus === "error" && (
            <Badge variant="destructive" className="text-[10px] px-1.5 h-4">{t("models.saveError")}</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={loadConfig} disabled={isLoading}>
          <RefreshCwIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="sm" onClick={openAddProvider} disabled={isLoading}>
          <PlusIcon className="size-4" />
          {t("models.addProvider")}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="flex justify-center px-6 py-6">
          <div className="w-full max-w-2xl space-y-4">
            {providers.length === 0 && (
              <div className="rounded-lg border px-4 py-12 text-center text-sm text-muted-foreground">
                {isLoading ? t("models.loading") : t("models.emptyProviders")}
              </div>
            )}

            {providers.map((provider, pi) => (
              <div key={`${provider.baseURL}-${pi}`} className="rounded-lg border overflow-hidden">
                {/* Provider header */}
                <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-muted/30">
                  <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <ServerIcon className="size-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {providerDisplayName(provider, t)}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{provider.baseURL}</div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => openAddModel(pi)}>
                    <PlusIcon className="size-3.5 mr-0.5" />
                    {t("models.addModel")}
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => openEditProvider(pi)}>
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirm({ kind: "provider", providerIndex: pi, label: providerDisplayName(provider, t) })}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>

                {/* Models under this provider */}
                {provider.models.length === 0 ? (
                  <div className="px-4 py-4 text-center text-xs text-muted-foreground">
                    {t("models.emptyModels")}
                  </div>
                ) : (
                  <div className="divide-y">
                    {provider.models.map((model) => (
                      <div key={model.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="font-mono text-sm truncate">{model.id}</span>
                          {defaultModel === model.id && (
                            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25 text-[10px] px-1.5 h-4 shrink-0">
                              <MessageSquareIcon className="size-2.5 mr-0.5" />
                              {t("models.defaultBadge")}
                            </Badge>
                          )}
                          {backgroundModel === model.id && (
                            <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/25 text-[10px] px-1.5 h-4 shrink-0">
                              <ZapIcon className="size-2.5 mr-0.5" />
                              {t("models.backgroundBadge")}
                            </Badge>
                          )}
                          {model.contextLimit ? (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {Math.round(model.contextLimit / 1000)}k{model.outputTokens ? ` · out ${Math.round(model.outputTokens / 1000)}k` : ''}
                            </span>
                          ) : model.outputTokens ? (
                            <span className="text-[10px] text-muted-foreground shrink-0">out {Math.round(model.outputTokens / 1000)}k</span>
                          ) : null}
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          {defaultModel !== model.id && (
                            <Button
                              variant="ghost" size="sm" className="text-xs h-6 px-2"
                              onClick={() => applyChange(providers, model.id, backgroundModel)}
                            >
                              {t("models.setDefault")}
                            </Button>
                          )}
                          {backgroundModel === model.id ? (
                            <Button
                              variant="ghost" size="sm" className="text-xs h-6 px-2"
                              onClick={() => applyChange(providers, defaultModel, "")}
                            >
                              {t("models.unsetBackground")}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost" size="sm" className="text-xs h-6 px-2"
                              onClick={() => applyChange(providers, defaultModel, model.id)}
                            >
                              {t("models.setBackground")}
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="size-6" onClick={() => openEditModel(pi, model)}>
                            <PencilIcon className="size-3" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="size-6 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirm({ kind: "model", providerIndex: pi, modelId: model.id, label: model.id })}
                          >
                            <Trash2Icon className="size-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Background model hint */}
            {providers.length > 0 && (
              <p className="text-xs text-muted-foreground px-1">
                <ZapIcon className="size-3 inline mr-1 align-[-1px]" />
                {backgroundModel
                  ? t("models.backgroundHint", { model: backgroundModel })
                  : t("models.backgroundHintUnset")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Provider Add/Edit Dialog */}
      <Dialog open={providerEdit !== null} onOpenChange={(open) => { if (!open) setProviderEdit(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {providerEdit?.index === null ? t("models.providerEdit.addTitle") : t("models.providerEdit.editTitle")}
            </DialogTitle>
            <DialogDescription>{t("models.providerEdit.description")}</DialogDescription>
          </DialogHeader>

          {providerEdit && (
            <div className="space-y-3">
              {/* 第一行:供应商(预设下拉;选"自定义"时旁边出现名称输入框) */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("models.providerEdit.providerTitle")}</label>
                <div className="flex items-center gap-2">
                  <Select
                    value={providerEdit.preset}
                    onValueChange={(value) => {
                      const preset = PROVIDER_PRESETS.find((p) => p.id === value)
                      if (!preset) return
                      if (preset.id === "custom") {
                        // 切到自定义:清空联动的 baseURL,让用户自己填名称和地址
                        setProviderEdit(prev => prev ? {
                          ...prev,
                          preset: "custom",
                          provider: { ...prev.provider, name: "", baseURL: "" },
                        } : prev)
                      } else {
                        // 选预设:名称跟随预设、baseURL 联动填充
                        setProviderEdit(prev => prev ? {
                          ...prev,
                          preset: preset.id,
                          provider: { ...prev.provider, name: "", baseURL: preset.baseURL },
                        } : prev)
                      }
                      setProviderError(null)
                    }}
                  >
                    <SelectTrigger className={providerEdit.preset === "custom" ? "w-32 text-xs shrink-0" : "w-full text-xs"}>
                      <SelectValue placeholder="..." />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDER_PRESETS.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs cursor-pointer">
                          {t(`models.provider.${p.id}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {providerEdit.preset === "custom" && (
                    <Input
                      type="text"
                      value={providerEdit.provider.name}
                      onChange={(e) => updateProviderField({ name: e.target.value })}
                      placeholder={t("models.providerEdit.namePlaceholder")}
                      className="text-xs"
                    />
                  )}
                </div>
              </div>

              {/* 第二行:Base URL(与第一行联动;预设模式下也允许微调) */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("models.baseURL.title")}</label>
                <Input
                  type="text"
                  value={providerEdit.provider.baseURL}
                  onChange={(e) => updateProviderField({ baseURL: e.target.value })}
                  placeholder={t("models.baseURL.placeholder")}
                  className="font-mono text-xs"
                />
              </div>

              {/* 第三行:API Key */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("models.apiKey.title")}</label>
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={providerEdit.provider.apiKey}
                    onChange={(e) => updateProviderField({ apiKey: e.target.value })}
                    placeholder={t("models.apiKey.placeholder")}
                    className="pr-8 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showApiKey ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
                  </button>
                </div>
              </div>

              {providerError && (
                <div className="flex items-center gap-1.5 text-xs text-red-500">
                  <AlertCircleIcon className="size-3.5" />
                  <span>{providerError}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setProviderEdit(null)} disabled={isVerifying}>
              {t("models.providerEdit.cancel")}
            </Button>
            <Button size="sm" onClick={handleSaveProvider} disabled={isVerifying}>
              {isVerifying ? (
                <>
                  <RefreshCwIcon className="size-3.5 mr-1 animate-spin" />
                  {t("models.providerEdit.verifying")}
                </>
              ) : (
                t("models.providerEdit.save")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation (provider or model) */}
      <DeleteConfirmDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => { if (!open) setDeleteConfirm(null) }}
        onConfirm={handleConfirmDelete}
        itemName={deleteConfirm?.label ?? ""}
      />

      {/* Model Add/Edit Dialog */}
      <Dialog open={modelAdd !== null} onOpenChange={(open) => { if (!open) setModelAdd(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {modelAdd?.editingId ? t("models.modelEdit.editTitle") : t("models.modelEdit.addTitle")}
            </DialogTitle>
            <DialogDescription>
              {modelAdd && providers[modelAdd.providerIndex]
                ? providerDisplayName(providers[modelAdd.providerIndex], t)
                : ""}
            </DialogDescription>
          </DialogHeader>

          {modelAdd && (
            <div className="space-y-3">
              {/* Model name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("models.modelName.title")}</label>
                <Input
                  type="text"
                  value={modelAdd.id}
                  onChange={(e) => { setModelAdd(prev => prev ? { ...prev, id: e.target.value } : prev); setModelError(null) }}
                  placeholder={t("models.modelName.placeholder")}
                  className="font-mono text-xs"
                />
              </div>

              {/* Context limit */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("models.contextLimit.title")}</label>
                <Input
                  type="number"
                  value={modelAdd.contextLimit ?? ""}
                  onChange={(e) => setModelAdd(prev => prev ? { ...prev, contextLimit: e.target.value ? Number(e.target.value) : undefined } : prev)}
                  placeholder={t("models.contextLimit.placeholder")}
                  className="font-mono text-xs"
                  min={0}
                />
              </div>

              {/* Output tokens limit（per-model maxOutputTokens，缺省 8000；预算/截断检测用） */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t("models.outputTokens.title")}</label>
                <Input
                  type="number"
                  value={modelAdd.outputTokens ?? ""}
                  onChange={(e) => setModelAdd(prev => prev ? { ...prev, outputTokens: e.target.value ? Number(e.target.value) : undefined } : prev)}
                  placeholder={t("models.outputTokens.placeholder")}
                  className="font-mono text-xs"
                  min={0}
                />
              </div>

              {modelError && (
                <div className="flex items-center gap-1.5 text-xs text-red-500">
                  <AlertCircleIcon className="size-3.5" />
                  <span>{modelError}</span>
                </div>
              )}

              {/* Fetch from provider */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchModels}
                  disabled={isFetchingModels}
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

                {fetchError && (
                  <div className="flex items-center gap-2 text-xs text-red-500">
                    <AlertCircleIcon className="size-3.5" />
                    <span>{fetchError}</span>
                  </div>
                )}

                {fetchedModels.length > 0 && (
                  <>
                    <div className="relative">
                      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder={t("models.fetchModels.searchPlaceholder")}
                        className="pl-9 text-xs"
                      />
                    </div>
                    <div className="border rounded-lg max-h-48 overflow-auto divide-y">
                      {filteredModels.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => { setModelAdd(prev => prev ? { ...prev, id: model.id } : prev); setModelError(null) }}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                        >
                          <span className="font-mono text-xs truncate">{model.id}</span>
                          {modelAdd.id === model.id && <span className="text-green-500 text-xs shrink-0 ml-2">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setModelAdd(null)}>
              {t("models.modelEdit.cancel")}
            </Button>
            {/* 编辑模式没有"继续添加"语义,只在新增时显示 */}
            {modelAdd?.editingId === null && (
              <Button variant="secondary" size="sm" onClick={() => handleSaveModel(true)}>
                {t("models.modelEdit.saveAndContinue")}
              </Button>
            )}
            <Button size="sm" onClick={() => handleSaveModel(false)}>
              {t("models.modelEdit.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
