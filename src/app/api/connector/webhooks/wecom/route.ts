// ============================================================
// 企业微信 Webhook 接收端点
// POST /api/connector/webhooks/wecom
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { WechatWebhookHandler } from '@/lib/connector/inbound/webhook-handler'
import { inboundEventQueue } from '@/lib/connector/inbound/event-queue'
import { getWecomWebhookConfig } from '@/lib/connector'

const handler = new WechatWebhookHandler()

export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    // 动态加载企业微信配置
    const wecomConfig = await getWecomWebhookConfig()

    if (!wecomConfig) {
      return NextResponse.json(
        { success: false, error: 'WeCom connector not configured' },
        { status: 500 }
      )
    }

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
    const result = await handler.handle({ query, body, headers }, wecomConfig)

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

  try {
    // 动态加载企业微信配置
    const wecomConfig = await getWecomWebhookConfig()

    if (!wecomConfig) {
      return NextResponse.json({
        status: 'not_configured',
        service: 'wecom-webhook',
        message: 'WeCom connector not configured. Add wecom.yaml to connectors/ directory.',
        timestamp: Date.now(),
      })
    }

    // 微信 URL 验证
    if (query.signature && query.timestamp && query.nonce) {
      const body = query.echostr || ''
      const headers: Record<string, string> = {}

      const result = await handler.handle({ query, body, headers }, wecomConfig)

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
  } catch (error) {
    console.error('[WeComWebhook] GET Error:', error)
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}