// ============================================================
// Connector Webhook 接收端点
// POST /api/connector/webhooks/test-service
// 用于测试服务互通 - 接收外部回调
// ============================================================

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    console.log('[Webhook Test-Service] Received event:', JSON.stringify(body, null, 2))

    // 构建入站消息事件
    const event = {
      event_id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      connector_type: 'test-service',
      channel_id: body.channel_id || 'webhook-test',
      sender: {
        id: body.sender_id || 'webhook-caller',
        name: body.sender_name || 'Webhook Caller',
        type: 'user' as const,
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
      },
    }

    console.log('[Webhook Test-Service] Processed event:', event)

    // 这里应该将事件推送到 Agent 处理
    // 目前先记录日志，实际集成时连接到 Agent Core

    // 立即返回 200（微信/飞书要求 5 秒内响应）
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
  const { searchParams } = new URL(req.url)
  const challenge = searchParams.get('challenge')

  if (challenge) {
    return NextResponse.json({ challenge })
  }

  return NextResponse.json({
    status: 'ok',
    service: 'test-service-webhook',
    timestamp: Date.now(),
  })
}
