// ============================================================
// 通用 Webhook 接收端点
// POST /api/connector/webhooks/[handler]
// 自动根据 handler 类型匹配配置和处理器
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createWebhookHandler } from '@/lib/connector/inbound/webhook-handler'
import { inboundEventQueue } from '@/lib/connector/inbound/event-queue'
import {
  getWebhookConfigByHandler,
  buildWechatWebhookConfig,
  buildFeishuWebhookConfig,
} from '@/lib/connector'

/**
 * 动态路由参数
 */
interface RouteParams {
  params: Promise<{
    handler: string
  }>
}

/**
 * 通用 POST 处理器
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const startTime = Date.now()
  const { handler } = await params

  console.log('[Webhook] Received request for handler:', handler)

  try {
    // 获取请求参数
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

    // 根据 handler 类型构建配置
    let webhookHandlerResult

    switch (handler) {
      case 'wecom': {
        const config = await buildWechatWebhookConfig('wecom', 'wecom')
        const handlerInstance = createWebhookHandler('wecom')
        if (!handlerInstance) {
          return NextResponse.json({ success: false, error: 'Handler not supported: wecom' }, { status: 400 })
        }
        webhookHandlerResult = await handlerInstance.handle({ query, body, headers }, {
          token: config.token,
          encodingAesKey: config.encodingAesKey,
          appId: config.appId,
          subtype: 'wecom',
        })
        break
      }

      case 'wechat-mp': {
        const config = await buildWechatWebhookConfig('wechat-mp', 'wechat-mp')
        const handlerInstance = createWebhookHandler('wechat-mp')
        if (!handlerInstance) {
          return NextResponse.json({ success: false, error: 'Handler not supported: wechat-mp' }, { status: 400 })
        }
        webhookHandlerResult = await handlerInstance.handle({ query, body, headers }, {
          token: config.token,
          encodingAesKey: config.encodingAesKey,
          appId: config.appId,
          subtype: 'wechat-mp',
        })
        break
      }

      case 'wechat-kf': {
        const config = await buildWechatWebhookConfig('wechat-kf', 'wechat-kf')
        const handlerInstance = createWebhookHandler('wechat-kf')
        if (!handlerInstance) {
          return NextResponse.json({ success: false, error: 'Handler not supported: wechat-kf' }, { status: 400 })
        }
        webhookHandlerResult = await handlerInstance.handle({ query, body, headers }, {
          token: config.token,
          encodingAesKey: config.encodingAesKey,
          appId: config.appId,
          subtype: 'wechat-kf',
        })
        break
      }

      case 'feishu': {
        const config = await buildFeishuWebhookConfig('feishu')
        const handlerInstance = createWebhookHandler('feishu')
        if (!handlerInstance) {
          return NextResponse.json({ success: false, error: 'Handler not supported: feishu' }, { status: 400 })
        }
        webhookHandlerResult = await handlerInstance.handle({ query, body, headers }, {
          encryptKey: config.encryptKey,
          verificationToken: config.verificationToken,
        })
        break
      }

      case 'test-service': {
        // 测试服务使用 JSON body
        let jsonBody: Record<string, unknown> = {}
        try {
          jsonBody = JSON.parse(body)
        } catch {
          // 非 JSON 格式
        }

        const messageType = (jsonBody.message_type as string) || 'text'
        const validTypes = ['text', 'image', 'file', 'event'] as const
        const type = validTypes.includes(messageType as typeof validTypes[number])
          ? (messageType as typeof validTypes[number])
          : 'text'

        const event = {
          event_id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          connector_type: 'test-service',
          channel_id: (jsonBody.channel_id as string) || 'webhook-test',
          sender: {
            id: (jsonBody.sender_id as string) || 'webhook-caller',
            name: (jsonBody.sender_name as string) || 'Webhook Caller',
            type: 'user' as const,
          },
          message: {
            id: (jsonBody.message_id as string) || `msg-${Date.now()}`,
            type,
            text: (jsonBody.content as string) || body,
            raw: jsonBody,
          },
          timestamp: Date.now(),
          reply_context: {
            connector_type: 'test-service',
            channel_id: (jsonBody.channel_id as string) || 'webhook-test',
            reply_to_message_id: jsonBody.message_id as string,
          },
        }

        await inboundEventQueue.push(event)
        console.log('[Webhook Test-Service] Event queued:', event.event_id, 'duration:', Date.now() - startTime, 'ms')

        return NextResponse.json({
          success: true,
          event_id: event.event_id,
          message: 'Event received and queued for processing',
        })
      }

      default: {
        // 尝试从配置动态加载
        const config = await getWebhookConfigByHandler(handler)
        if (!config) {
          return NextResponse.json({
            success: false,
            error: `Unknown handler: ${handler}. Add connector config in connectors/${handler}.yaml`,
          }, { status: 404 })
        }

        // 对于未知的 handler，返回配置信息但不处理
        // 需要在 webhook-handler.ts 中添加对应的处理器
        return NextResponse.json({
          success: false,
          error: `Handler '${handler}' configured but processor not implemented. Add to webhook-handler.ts factory.`,
          config_available: true,
          handler_type: config.handler,
        }, { status: 400 })
      }
    }

    // URL 验证场景：返回 challenge
    if (webhookHandlerResult?.challenge) {
      return new Response(webhookHandlerResult.challenge, { status: 200 })
    }

    // 入站消息：推送到事件队列
    if (webhookHandlerResult?.success && webhookHandlerResult.event) {
      await inboundEventQueue.push(webhookHandlerResult.event)
      console.log('[Webhook] Event queued:', webhookHandlerResult.eventId, 'duration:', Date.now() - startTime, 'ms')
    }

    // 立即返回 200（微信/飞书要求 5 秒内响应）
    return NextResponse.json({
      success: webhookHandlerResult?.success ?? false,
      event_id: webhookHandlerResult?.eventId,
      error: webhookHandlerResult?.error,
    }, {
      status: webhookHandlerResult?.success ? 200 : 400,
    })

  } catch (error) {
    console.error('[Webhook] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET 用于 Webhook URL 验证
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { handler } = await params

  const url = new URL(req.url)
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })

  try {
    // URL 验证（微信系）
    if (query.signature && query.timestamp && query.nonce && query.echostr) {
      switch (handler) {
        case 'wecom': {
          const config = await buildWechatWebhookConfig('wecom', 'wecom')
          const handlerInstance = createWebhookHandler('wecom')
          if (handlerInstance) {
            const result = await handlerInstance.handle({ query, body: query.echostr, headers: {} }, {
              token: config.token,
              encodingAesKey: config.encodingAesKey,
              appId: config.appId,
              subtype: 'wecom',
            })
            if (result.challenge) {
              return new Response(result.challenge, { status: 200 })
            }
          }
          break
        }

        case 'wechat-mp':
        case 'wechat-kf': {
          const subtype = handler as 'wechat-mp' | 'wechat-kf'
          const config = await buildWechatWebhookConfig(handler, subtype)
          const handlerInstance = createWebhookHandler(handler)
          if (handlerInstance) {
            const result = await handlerInstance.handle({ query, body: query.echostr, headers: {} }, {
              token: config.token,
              encodingAesKey: config.encodingAesKey,
              appId: config.appId,
              subtype,
            })
            if (result.challenge) {
              return new Response(result.challenge, { status: 200 })
            }
          }
          break
        }
      }

      return NextResponse.json({ success: false, error: 'URL verification failed' }, { status: 400 })
    }

    // 健康检查
    const config = await getWebhookConfigByHandler(handler)

    return NextResponse.json({
      status: config ? 'configured' : 'not_configured',
      service: `${handler}-webhook`,
      handler,
      message: config
        ? 'Connector configured and ready'
        : `Add connectors/${handler}.yaml to enable this webhook`,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('[Webhook] GET Error:', error)
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}