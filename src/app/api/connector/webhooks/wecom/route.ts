// ============================================================
// 企业微信 Webhook 接收端点
// POST /api/connector/webhooks/wecom
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { WechatWebhookHandler } from '@/lib/connector/inbound/webhook-handler'
import { inboundEventQueue } from '@/lib/connector/inbound/event-queue'

// 企业微信配置（从环境变量或 Connector 配置读取）
const WECOM_CONFIG = {
  token: process.env.WECOM_TOKEN || '',
  encodingAesKey: process.env.WECOM_ENCODING_AES_KEY || '',
  appId: process.env.WECOM_CORP_ID || '',
  subtype: 'wecom' as const,
}

const handler = new WechatWebhookHandler()

export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    // 获取查询参数
    const url = new URL(req.url)
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })

    // 获取请求体（微信发送的是 XML）
    const body = await req.text()

    // 获取请求头
    const headers: Record<string, string> = {}
    req.headers.forEach((value, key) => {
      headers[key] = value
    })

    // 处理 Webhook
    const result = await handler.handle({ query, body, headers }, WECOM_CONFIG)

    // URL 验证场景：返回 challenge
    if (result.challenge) {
      return new Response(result.challenge, { status: 200 })
    }

    // 入站消息：推送到事件队列（异步处理）
    if (result.success && result.event) {
      await inboundEventQueue.push(result.event)
      console.log('[WeComWebhook] Event queued:', result.eventId, 'duration:', Date.now() - startTime, 'ms')
    }

    // 立即返回 200（微信要求 5 秒内响应）
    return NextResponse.json({
      success: result.success,
      event_id: result.eventId,
      error: result.error,
    }, {
      status: result.success ? 200 : 400,
    })

  } catch (error) {
    console.error('[WeComWebhook] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

// GET 用于 Webhook URL 验证
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })

  // 微信 URL 验证
  if (query.signature && query.timestamp && query.nonce) {
    const body = query.echostr || ''
    const headers: Record<string, string> = {}

    const result = await handler.handle({ query, body, headers }, WECOM_CONFIG)

    if (result.challenge) {
      return new Response(result.challenge, { status: 200 })
    }

    return NextResponse.json({ success: false, error: 'URL verification failed' }, { status: 400 })
  }

  return NextResponse.json({
    status: 'ok',
    service: 'wecom-webhook',
    timestamp: Date.now(),
  })
}