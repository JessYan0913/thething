import path from 'path'
import os from 'os'
import { NextRequest, NextResponse } from 'next/server'
import { loadGlobalConfig, saveGlobalConfig, getGlobalConfigPath, type ProviderEntry } from '@the-thing/core'

export const runtime = 'nodejs'

// 遵循 Dot Agents 协议：配置文件固定在 ~/.agents/ 下
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.agents')

// GET 返回 providers 分组(设置页消费)+ models 摊平视图(选择器消费)。
// 旧格式文件由 loadGlobalConfig 归一化,GET 返回的总是最新格式。
export async function GET() {
  const config = loadGlobalConfig(GLOBAL_CONFIG_DIR)
  return NextResponse.json({
    providers: config?.providers ?? [],
    models: config?.models ?? [],
    defaultModel: config?.defaultModel ?? '',
    backgroundModel: config?.backgroundModel ?? '',
    path: getGlobalConfigPath(GLOBAL_CONFIG_DIR),
  })
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  const providers: ProviderEntry[] = Array.isArray(body.providers)
    ? body.providers
        .filter((p: Partial<ProviderEntry>) => p && typeof p.baseURL === 'string' && p.baseURL.trim())
        .map((p: Partial<ProviderEntry>) => ({
          // name 可选:留空时 UI 回落到预设供应商名或域名
          name: String(p.name ?? '').trim(),
          baseURL: String(p.baseURL).trim(),
          apiKey: String(p.apiKey ?? '').trim(),
          models: Array.isArray(p.models)
            ? p.models
                .filter((m) => m && typeof m.id === 'string' && m.id.trim())
                .map((m) => ({
                  id: String(m.id).trim(),
                  ...(m.contextLimit ? { contextLimit: Number(m.contextLimit) } : {}),
                  ...(m.outputTokens ? { outputTokens: Number(m.outputTokens) } : {}),
                }))
            : [],
        }))
    : []

  const ids = new Set(providers.flatMap(p => p.models.map(m => m.id)))
  const firstId = providers.flatMap(p => p.models)[0]?.id
  const defaultModel = typeof body.defaultModel === 'string' && ids.has(body.defaultModel)
    ? body.defaultModel
    : firstId
  const backgroundModel = typeof body.backgroundModel === 'string' && ids.has(body.backgroundModel)
    ? body.backgroundModel
    : undefined

  saveGlobalConfig({ providers, defaultModel, backgroundModel }, GLOBAL_CONFIG_DIR)
  return NextResponse.json({ ok: true })
}
