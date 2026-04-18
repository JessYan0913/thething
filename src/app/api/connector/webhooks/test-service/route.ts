// ============================================================
// Connector Webhook 接收端点
// POST /api/connector/webhooks/test-service
// 用于测试服务互通 - 接收外部回调
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { inboundEventQueue } from '@/lib/connector/inbound/event-queue'
import { getTestServiceWebhookConfig } from '@/lib/connector'
import type { InboundMessageEvent } from '@/lib/connector/types'

export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    // 动态加载测试服务配置
    const config = await getTestServiceWebhookConfig()

    const body = await req.json()

    console.log('[Webhook Test-Service] Received event:', JSON.stringify(body, null, 2))

    // 构建入站消息事件
    const event: InboundMessageEvent = {
      event_id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      connector_type: 'test-service',
      channel_id: body.channel_id || 'webhook-test',
      sender: {
        id: body.sender_id || 'webhook-caller',
        name: body.sender_name || 'Webhook Caller',
        type: 'user',
      },
      message: {
        id: body.message_id || `msg-${Date.now()}`,
        type: body.message_type || 'text',
        text: body.content || JSON.stringify(body),
        raw: body,
      },
      timestamp: Date.now(),
      reply_context: {
        connector_type: 'test-service',
        channel_id: body.channel_id || 'webhook-test',
        reply_to_message_id: body.message_id,
      },
    }

    // 推送到事件队列（异步处理）
    await inboundEventQueue.push(event)

    console.log('[Webhook Test-Service] Event queued:', event.event_id, 'duration:', Date.now() - startTime, 'ms')

    // 立即返回 200
    return NextResponse.json({
      success: true,
      event_id: event.event_id,
      message: 'Event received and queued for processing',
    })
  } catch (error) {
    console.error('[Webhook Test-Service] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

// 处理 GET 请求 - 用于验证 Webhook URL 是否可用
export async function GET(req: NextRequest) {
  try {
    // 动态加载测试服务配置
    const config = await getTestServiceWebhookConfig()

    const { searchParams } = new URL(req.url)
    const challenge = searchParams.get('challenge')

    if (challenge) {
      return NextResponse.json({ challenge })
    }

    return NextResponse.json({
      status: 'ok',
      service: 'test-service-webhook',
      configured: config !== null && Object.keys(config).length > 0,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('[Webhook Test-Service] GET Error:', error)
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}