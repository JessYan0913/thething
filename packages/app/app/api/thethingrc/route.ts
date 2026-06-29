import { NextRequest, NextResponse } from 'next/server'
import { loadTheThingRC, saveTheThingRC } from '@/lib/runtime'

export const runtime = 'nodejs'

export async function GET() {
  const config = loadTheThingRC()
  return NextResponse.json({
    dataDir: config?.dataDir ?? '',
  })
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  await saveTheThingRC({ dataDir: body.dataDir?.trim() || '' })
  return NextResponse.json({ ok: true })
}
