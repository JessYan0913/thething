import { NextRequest, NextResponse } from 'next/server'
import { loadPreferences, savePreferences } from '@/lib/preferences'

export const runtime = 'nodejs'

export async function GET() {
  const prefs = await loadPreferences()
  return NextResponse.json(prefs)
}

export async function PUT(request: NextRequest) {
  const body = await request.json()

  // 只允许更新已知字段
  const allowedFields = ['selectedModel', 'selectedAgent', 'approvalMode']
  const update: Record<string, unknown> = {}

  for (const key of allowedFields) {
    if (key in body) {
      update[key] = body[key]
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 })
  }

  await savePreferences(update)
  return NextResponse.json({ ok: true })
}
