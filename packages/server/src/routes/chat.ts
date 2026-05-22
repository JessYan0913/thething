// ============================================================
// Chat API - 流式响应（使用新 API）
// ============================================================

import { Hono } from 'hono'
import {
  createAgent,
  generateConversationTitle,
  estimateMessagesTokens,
  finalizeAgentRun,
  loadGlobalConfig,
  type SubAgentStreamWriter,
} from '@the-thing/core'
import { getServerContext, getServerDataStore } from '../runtime'
import { ENV_MODEL } from '../env-names'
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai'

const app = new Hono()

// GET: Load messages for a conversation
app.get('/', async (c) => {
  try {
    const conversationId = c.req.query('conversationId')

    if (!conversationId) {
      return c.json({ error: 'Missing conversationId' }, 400)
    }

    const store = await getServerDataStore()
    const messages = store.messageStore.getMessagesByConversation(conversationId)
    return c.json({ messages })
  } catch (error) {
    console.error('[Chat API] GET error:', error)
    return c.json({ error: 'Failed to load messages' }, 500)
  }
})

// POST: Stream chat response
app.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      message: UIMessage
      conversationId: string
      userId?: string
    }>()

    const { message, conversationId, userId: messageUserId } = body

    if (!conversationId) {
      return c.json({ error: 'Missing conversationId' }, 400)
    }

    // ============================================================
    // Step 1: 获取 Server Context（应用进程级别）
    // ============================================================
    const context = await getServerContext()
    const store = context.runtime.dataStore

    let existingMessages = store.messageStore.getMessagesByConversation(conversationId)
    const isFirstMessage = existingMessages.length === 0

    const existingMessageIndex = existingMessages.findIndex((m: UIMessage) => m.id === message.id)
    if (existingMessageIndex >= 0) {
      existingMessages = existingMessages.slice(0, existingMessageIndex)
    } else {
      const lastUserMessageIndex = existingMessages.findLastIndex((m: UIMessage) => m.role === 'user')
      if (lastUserMessageIndex >= 0 && existingMessages[lastUserMessageIndex].id === message.id) {
        existingMessages = existingMessages.slice(0, lastUserMessageIndex)
      }
    }

    const messages: UIMessage[] = [...existingMessages, message]

    const writerRef: { current: SubAgentStreamWriter | null } = { current: null }
    const userId = messageUserId || 'default'

    // ============================================================
    // Step 2: 创建 Agent（使用新 API）
    // ============================================================
    const globalConfig = loadGlobalConfig()
    const {
      agent,
      sessionState,
      mcpRegistry,
      model,
      adjustedMessages,
      memoryBaseDir,
    } = await createAgent({
      context,
      conversationId,
      messages,
      userId,
      model: {
        apiKey: process.env.THETHING_API_KEY || globalConfig?.apiKey || '',
        baseURL: process.env.THETHING_BASE_URL || globalConfig?.baseURL || '',
        modelName: process.env[ENV_MODEL] || globalConfig?.model || 'qwen-max',
        includeUsage: true,
      },
    })

    // 使用调整后的消息（包含注入的附件）
    const messagesWithAttachments = adjustedMessages ?? messages

    // 记录 LLM Input
    console.log(
      `[LLM Input] ${messagesWithAttachments.length} messages:\n` +
        messagesWithAttachments
          .map((m, i) => {
            const partSummaries = m.parts.map((p) => {
              if (p.type === 'text') return `text(${(p as { text: string }).text.slice(0, 40)})`
              if (p.type === 'file') {
                const fp = p as { mediaType?: string; filename?: string; url?: string }
                return `file(${fp.mediaType}, ${fp.filename ?? 'unnamed'}, url:${fp.url ? fp.url.slice(0, 30) + '...' : 'none'})`
              }
              return `[${p.type}]`
            })
            return `  [${i}] ${m.role}: ${partSummaries.join(' | ')}`
          })
          .join('\n'),
    )

    const abortController = new AbortController()

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writerRef.current = writer as unknown as SubAgentStreamWriter

        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: messagesWithAttachments,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            try {
              // 新消息：从注入后的消息数量开始
              const newAssistantMessages = completedMessages.slice(messagesWithAttachments.length)
              // 保存原始消息 + 新消息（排除附件）
              const messagesToSave = [...messages, ...newAssistantMessages]

              console.log(
                `[Storage] Saving ${messagesToSave.length} messages (${messages.length} original + ${newAssistantMessages.length} new)`,
              )

              const costSummary = sessionState.costTracker.getSummary()
              console.log(
                `[Cost] Total: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
              )

              await finalizeAgentRun({
                dataStore: store,
                messages: messagesToSave,
                conversationId,
                costTracker: sessionState.costTracker,
                mcpRegistry,
                model,
                isNewConversation: isFirstMessage,
                userId,
                memoryBaseDir,
              })
            } catch (err) {
              console.error('[Chat API] onFinish error:', err)
            }
          },
        })

        writer.merge(agentStream)
      },
      onError: (err) => String(err),
    })

    return createUIMessageStreamResponse({
      stream,
      headers: { 'X-Conversation-Id': conversationId },
    })
  } catch (error) {
    console.error('[Chat API] POST error:', error)
    return c.json({ error: 'Failed to process chat request' }, 500)
  }
})

// PATCH: Save messages
app.patch('/', async (c) => {
  try {
    const body = await c.req.json<{ conversationId: string; messages: UIMessage[] }>()

    if (!body.conversationId || !body.messages) {
      return c.json({ error: 'Missing conversationId or messages' }, 400)
    }

    const store = await getServerDataStore()
    store.messageStore.saveMessages(body.conversationId, body.messages)

    return c.json({ success: true })
  } catch (error) {
    console.error('[Chat API] PATCH error:', error)
    return c.json({ error: 'Failed to save messages' }, 500)
  }
})

export default app