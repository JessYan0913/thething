import { NextRequest, NextResponse } from 'next/server'
import { loadGlobalConfig, saveGlobalConfig, getGlobalConfigPath } from '@the-thing/core'

export async function GET() {
  const config = loadGlobalConfig()
  return NextResponse.json({
    apiKey: config?.apiKey ?? '',
    baseURL: config?.baseURL ?? '',
    modelAliases: config?.modelAliases ?? { fast: '', smart: '', default: '' },
    path: getGlobalConfigPath(),
  })
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  const config = {
    apiKey: body.apiKey ?? '',
    baseURL: body.baseURL ?? '',
    ...(body.modelAliases ? {
      modelAliases: {
        fast: body.modelAliases.fast ?? '',
        smart: body.modelAliases.smart ?? '',
        default: body.modelAliases.default ?? '',
      }
    } : {}),
  }
  saveGlobalConfig(config)
  return NextResponse.json({ ok: true })
}
