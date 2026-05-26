import { NextRequest, NextResponse } from 'next/server'
import { loadGlobalConfig, saveGlobalConfig, getGlobalConfigPath } from '@the-thing/core'

export async function GET() {
  const config = loadGlobalConfig()
  return NextResponse.json({
    config: config ?? { apiKey: '', baseURL: '', model: '' },
    path: getGlobalConfigPath(),
  })
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  const config = {
    apiKey: body.apiKey ?? '',
    baseURL: body.baseURL ?? '',
    model: body.model ?? '',
  }
  saveGlobalConfig(config)
  return NextResponse.json({ ok: true })
}
