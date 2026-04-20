// ============================================================
// Connector Webhooks API - 动态 handler 路由
// ============================================================

import { Hono } from 'hono'
import {
  createWebhookHandler,
  inboundEventQueue,
  getWebhookConfigByHandler,
  buildWechatWebhookConfig,
  buildFeishuWebhookConfig,
} from '@the-thing/core'

const app = new Hono()

// 通用 POST 处理器
app.post('/:handler', async (c) => {
  const startTime = Date.now()
  const handler = c.req.param('handler')

  console.log('[Webhook] Received request for handler:', handler)

  try {
    const url = new URL(c.req.url)
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })

    const body = await c.req.text()

    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value
    })

    let webhookHandlerResult

    switch (handler) {
      case 'wecom': {
        const config = await buildWechatWebhookConfig('wecom', 'wecom')
        const handlerInstance = createWebhookHandler('wecom')
        if (!handlerInstance) {
          return c.json({ success: false, error: 'Handler not supported: wecom' }, 400)
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
          return c.json({ success: false, error: 'Handler not supported: wechat-mp' }, 400)
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
          return c.json({ success: false, error: 'Handler not supported: wechat-kf' }, 400)
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
          return c.json({ success: false, error: 'Handler not supported: feishu' }, 400)
        }
        webhookHandlerResult = await handlerInstance.handle({ query, body, headers }, {
          encryptKey: config.encryptKey,
          verificationToken: config.verificationToken,
        })
        break
      }

      case 'test-service': {
        let jsonBody: Record<string, unknown> = {}
        try {
          jsonBody = JSON.parse(body)
        } catch {}

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

        return c.json({
          success: true,
          event_id: event.event_id,
          message: 'Event received and queued for processing',
        })
      }

      default: {
        const config = await getWebhookConfigByHandler(handler)
        if (!config) {
          return c.json({
            success: false,
            error: `Unknown handler: ${handler}. Add connector config in connectors/${handler}.yaml`,
          }, 404)
        }

        return c.json({
          success: false,
          error: `Handler '${handler}' configured but processor not implemented. Add to webhook-handler.ts factory.`,
          config_available: true,
          handler_type: config.handler,
        }, 400)
      }
    }

    if (webhookHandlerResult?.challenge) {
      return new Response(webhookHandlerResult.challenge, { status: 200 })
    }

    if (webhookHandlerResult?.success && webhookHandlerResult.event) {
      await inboundEventQueue.push(webhookHandlerResult.event)
      console.log('[Webhook] Event queued:', webhookHandlerResult.eventId, 'duration:', Date.now() - startTime, 'ms')
    }

    return c.json({
      success: webhookHandlerResult?.success ?? false,
      event_id: webhookHandlerResult?.eventId,
      error: webhookHandlerResult?.error,
    }, webhookHandlerResult?.success ? 200 : 400)

  } catch (error) {
    console.error('[Webhook] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})

// GET 用于 Webhook URL 验证
app.get('/:handler', async (c) => {
  const handler = c.req.param('handler')

  const url = new URL(c.req.url)
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })

  try {
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

      return c.json({ success: false, error: 'URL verification failed' }, 400)
    }

    const config = await getWebhookConfigByHandler(handler)

    return c.json({
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
    return c.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})

export default app