import { NextRequest, NextResponse } from 'next/server'
import { loadGlobalConfig, saveGlobalConfig, getGlobalConfigPath } from '@the-thing/core'

export const runtime = 'nodejs'

export async function GET() {
  const config = loadGlobalConfig()
  return NextResponse.json({
    apiKey: config?.apiKey ?? '',
    baseURL: config?.baseURL ?? '',
    modelAliases: {
      fast: {
        model: config?.modelAliases?.fast?.model ?? '',
        contextLimit: config?.modelAliases?.fast?.contextLimit,
      },
      smart: {
        model: config?.modelAliases?.smart?.model ?? '',
        contextLimit: config?.modelAliases?.smart?.contextLimit,
      },
      default: {
        model: config?.modelAliases?.default?.model ?? '',
        contextLimit: config?.modelAliases?.default?.contextLimit,
      },
    },
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
        fast: {
          model: body.modelAliases.fast?.model ?? '',
          contextLimit: body.modelAliases.fast?.contextLimit ? Number(body.modelAliases.fast.contextLimit) : undefined,
        },
        smart: {
          model: body.modelAliases.smart?.model ?? '',
          contextLimit: body.modelAliases.smart?.contextLimit ? Number(body.modelAliases.smart.contextLimit) : undefined,
        },
        default: {
          model: body.modelAliases.default?.model ?? '',
          contextLimit: body.modelAliases.default?.contextLimit ? Number(body.modelAliases.default.contextLimit) : undefined,
        },
      }
    } : {}),
  }
  saveGlobalConfig(config)
  return NextResponse.json({ ok: true })
}
