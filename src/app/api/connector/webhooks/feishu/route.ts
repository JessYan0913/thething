// ============================================================
// 飞书 Webhook 接收端点
// POST /api/connector/webhooks/feishu
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { FeishuWebhookHandlerAdapter } from '@/lib/connector/inbound/webhook-handler'
import { inboundEventQueue } from '@/lib/connector/inbound/event-queue'

// 飞书配置
const FEISHU_CONFIG = {
  encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
}

const handler = new FeishuWebhookHandlerAdapter()

export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    const url = new URL(req.url)
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })

    const body = await req.text()

    const headers: Record<string, string> = {}
    req.headers.forEach((value, key) => {
      headers[key] = value
    })

    const result = await handler.handle({ query, body, headers }, FEISHU_CONFIG)

    // URL 验证场景：返回 challenge
    if (result.challenge) {
      return NextResponse.json({ challenge: result.challenge })
    }

    // 入站消息：推送到事件队列
    if (result.success && result.event) {
      await inboundEventQueue.push(result.event)
      console.log('[FeishuWebhook] Event queued:', result.eventId, 'duration:', Date.now() - startTime, 'ms')
    }

    return NextResponse.json({
      success: result.success,
      event_id: result.eventId,
      error: result.error,
    }, {
      status: result.success ? 200 : 400,
    })

  } catch (error) {
    console.error('[FeishuWebhook] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const challenge = searchParams.get('challenge')

  if (challenge) {
    return NextResponse.json({ challenge })
  }

  return NextResponse.json({
    status: 'ok',
    service: 'feishu-webhook',
    timestamp: Date.now(),
  })
}