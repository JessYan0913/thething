// ============================================================
// Chat API - 流式响应（使用统一的 createChatAgent）
// ============================================================

import { Hono } from 'hono'
import {
  createChatAgent,
  generateConversationTitle,
  getGlobalDataStore,
  compactMessagesIfNeeded,
  estimateMessagesTokens,
  runCompactInBackground,
  extractMemoriesInBackground,
  type SubAgentStreamWriter,
  createModelProvider,
  getProjectDir,
} from '@the-thing/core'
import { ENV_MODEL } from '../env-names'
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai'

const app = new Hono()

const dashscope = createModelProvider({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
  modelName: process.env[ENV_MODEL]!,
  includeUsage: true,
})

// GET: Load messages for a conversation
app.get('/', (c) => {
  try {
    const conversationId = c.req.query('conversationId')

    if (!conversationId) {
      return c.json({ error: 'Missing conversationId' }, 400)
    }

    const store = getGlobalDataStore()
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

    const store = getGlobalDataStore()
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

    const { messages: compactedMessages, executed: compactionExecuted } = await compactMessagesIfNeeded(
      messages,
      conversationId,
    )

    const preCompactionTokens = estimateMessagesTokens(messages)
    const postCompactionTokens = estimateMessagesTokens(compactedMessages)
    console.log(`[Tokens] Pre: ${preCompactionTokens}, Post: ${postCompactionTokens}`)
    console.log(
      `[LLM Input] ${compactedMessages.length} messages:\n` +
        compactedMessages
          .map((m, i) => {
            const part = m.parts[0]
            const text = part?.type === 'text' ? part.text : `[${part?.type}]`
            return `  [${i}] ${m.role}: ${text.replace(/\n/g, ' ').slice(0, 60)}${text.length > 60 ? '…' : ''}`
          })
          .join('\n'),
    )

    const writerRef: { current: SubAgentStreamWriter | null } = { current: null }
    const userId = messageUserId || 'default'

    // 使用统一的 getProjectDir 获取项目根目录
    const projectDir = getProjectDir()

    const { agent, sessionState, mcpRegistry, model } = await createChatAgent({
      conversationId,
      messages: compactedMessages,
      userId,
      modelConfig: {
        apiKey: process.env.DASHSCOPE_API_KEY!,
        baseURL: process.env.DASHSCOPE_BASE_URL!,
        modelName: process.env[ENV_MODEL]!,
        includeUsage: true,
      },
      conversationMeta: {
        messageCount: compactedMessages.length,
        isNewConversation: isFirstMessage,
        conversationStartTime: Date.now(),
      },
      enableMcp: true,
      enableSkills: true,
      enableMemory: true,
      enableConnector: true,
      writerRef,
      sessionOptions: {
        projectDir,
      },
    })

    const abortController = new AbortController()

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writerRef.current = writer as unknown as SubAgentStreamWriter

        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: compactedMessages,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            try {
              const newAssistantMessages = completedMessages.slice(compactedMessages.length)
              const messagesToSave = [...messages, ...newAssistantMessages]

              console.log(
                `[Storage] Saving ${messagesToSave.length} messages (${messages.length} original + ${newAssistantMessages.length} new)`,
              )

              store.messageStore.saveMessages(conversationId, messagesToSave)

              const costSummary = sessionState.costTracker.getSummary()
              console.log(
                `[Cost] Total: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
              )
              await sessionState.costTracker.persistToDB()

              // Background Memory Extraction
              extractMemoriesInBackground(
                completedMessages,
                userId,
                conversationId,
                model,
              ).catch((err) => console.error('[Memory Extraction] Error:', err))

              if (isFirstMessage) {
                const title = await generateConversationTitle(completedMessages, model)
                store.conversationStore.updateConversationTitle(conversationId, title)
                console.log(`[Title Generated] ${conversationId}: ${title}`)
              }

              runCompactInBackground(messagesToSave, conversationId, model)

              if (mcpRegistry) {
                await mcpRegistry.disconnectAll()
              }
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

    const store = getGlobalDataStore()
    store.messageStore.saveMessages(body.conversationId, body.messages)

    return c.json({ success: true })
  } catch (error) {
    console.error('[Chat API] PATCH error:', error)
    return c.json({ error: 'Failed to save messages' }, 500)
  }
})

export default app