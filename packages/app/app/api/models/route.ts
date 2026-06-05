import { NextRequest, NextResponse } from 'next/server'
import { loadGlobalConfig } from '@the-thing/core'

export const runtime = 'nodejs'

interface ModelInfo {
  id: string
  name?: string
  owned_by?: string
}

interface ModelsResponse {
  data: ModelInfo[]
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const baseURL = searchParams.get('baseURL')
  const apiKey = searchParams.get('apiKey')

  if (!baseURL) {
    return NextResponse.json({ error: 'baseURL is required' }, { status: 400 })
  }

  // 优先使用参数，其次使用全局配置
  const globalConfig = loadGlobalConfig()
  const resolvedBaseURL = baseURL || globalConfig?.baseURL
  const resolvedApiKey = apiKey || globalConfig?.apiKey

  if (!resolvedBaseURL) {
    return NextResponse.json({ error: 'Base URL is required' }, { status: 400 })
  }

  if (!resolvedApiKey) {
    return NextResponse.json({ error: 'API Key is required' }, { status: 400 })
  }

  try {
    // 构建模型列表 URL，确保以 /v1/models 或 /models 结尾
    let modelsUrl = resolvedBaseURL.replace(/\/$/, '')

    // 移除末尾的 /v1（如果存在），然后统一添加 /v1/models
    if (modelsUrl.endsWith('/v1')) {
      modelsUrl = modelsUrl + '/models'
    } else if (!modelsUrl.endsWith('/models')) {
      // 如果没有 /v1，添加 /v1/models
      if (!modelsUrl.includes('/v1/')) {
        modelsUrl = modelsUrl + '/v1/models'
      } else {
        modelsUrl = modelsUrl + '/models'
      }
    }

    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${resolvedApiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Models API] Failed to fetch models:', response.status, errorText)
      return NextResponse.json(
        { error: `Failed to fetch models: ${response.status}` },
        { status: response.status }
      )
    }

    const data: ModelsResponse = await response.json()

    // 过滤和排序模型列表
    const models = (data.data || [])
      .map(model => ({
        id: model.id,
        name: model.name || model.id,
        owned_by: model.owned_by,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))

    return NextResponse.json({ models })
  } catch (error) {
    console.error('[Models API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    )
  }
}
