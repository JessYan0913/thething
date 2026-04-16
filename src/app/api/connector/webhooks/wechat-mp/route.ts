// ============================================================
// 微信公众号 Webhook 接收端点
// POST /api/connector/webhooks/wechat-mp
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { WechatWebhookHandler } from '@/lib/connector/inbound/webhook-handler'
import { inboundEventQueue } from '@/lib/connector/inbound/event-queue'

// 微信公众号配置
const WECHAT_MP_CONFIG = {
  token: process.env.WECHAT_MP_TOKEN || '',
  encodingAesKey: process.env.WECHAT_MP_ENCODING_AES_KEY || '',
  appId: process.env.WECHAT_MP_APP_ID || '',
  subtype: 'wechat-mp' as const,
}

const handler = new WechatWebhookHandler()

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

    const result = await handler.handle({ query, body, headers }, WECHAT_MP_CONFIG)

    if (result.challenge) {
      return new Response(result.challenge, { status: 200 })
    }

    if (result.success && result.event) {
      await inboundEventQueue.push(result.event)
      console.log('[WeChatMPWebhook] Event queued:', result.eventId, 'duration:', Date.now() - startTime, 'ms')
    }

    return NextResponse.json({
      success: result.success,
      event_id: result.eventId,
      error: result.error,
    }, {
      status: result.success ? 200 : 400,
    })

  } catch (error) {
    console.error('[WeChatMPWebhook] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })

  if (query.signature && query.timestamp && query.nonce) {
    const body = query.echostr || ''
    const headers: Record<string, string> = {}

    const result = await handler.handle({ query, body, headers }, WECHAT_MP_CONFIG)

    if (result.challenge) {
      return new Response(result.challenge, { status: 200 })
    }

    return NextResponse.json({ success: false, error: 'URL verification failed' }, { status: 400 })
  }

  return NextResponse.json({
    status: 'ok',
    service: 'wechat-mp-webhook',
    timestamp: Date.now(),
  })
}