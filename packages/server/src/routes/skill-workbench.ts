// ============================================================
// Skill Workbench API - Skill 开发工作台
// ============================================================

import { Hono } from 'hono'
import {
  createAgent,
  finalizeAgentRun,
  type SubAgentStreamWriter,
} from '@the-thing/core'
import {
  getServerContext,
  getServerDataStore,
  getServerRuntime,
  reloadServerContext,
} from '../runtime'
import { ENV_MODEL } from '../env-names'
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai'
import { promises as fs } from 'fs'
import path from 'path'

const app = new Hono()

const WORKBENCH_PREAMBLE = `<system-reminder>
你是一个 Skill 开发助手。你的任务是帮助用户创建、测试和优化 Skill。

工作流程：
1. 理解用户需求后，使用 skill-creator 技能（通过 Skill 工具调用）来指导创建流程
2. 在 skills 目录下创建完整的 skill 文件夹（SKILL.md + scripts/ + references/ 等）
3. 创建完成后告知用户 skill 已就绪，可以请求测试
4. 测试时直接调用新创建的 skill（通过 Skill 工具），验证其行为是否符合预期
5. 根据用户反馈持续优化 skill 文件，每次修改后都可以重新测试

注意：每轮对话结束后系统会自动重新加载 skills，新创建或修改的 skill 在下一轮对话中即可通过 Skill 工具调用。
</system-reminder>
`

// POST /chat — 工作台对话流
app.post('/chat', async (c) => {
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

    // 首条消息注入 workbench 前言 + skills 目录路径
    if (isFirstMessage && messages.length > 0) {
      const runtime = await getServerRuntime()
      const skillsDirs = runtime.layout.resources.skills
      const skillsDir = skillsDirs[skillsDirs.length - 1]

      const firstMsg = messages[0]
      const originalText = firstMsg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')

      const preamble = WORKBENCH_PREAMBLE + `\nSkills 目录路径: ${skillsDir}\n`

      messages[0] = {
        ...firstMsg,
        parts: [
          { type: 'text' as const, text: preamble + originalText },
          ...firstMsg.parts.filter((p) => p.type !== 'text'),
        ],
      }
    }

    const writerRef: { current: SubAgentStreamWriter | null } = { current: null }
    const userId = messageUserId || 'default'

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
        apiKey: process.env.DASHSCOPE_API_KEY || '',
        baseURL: process.env.DASHSCOPE_BASE_URL || '',
        modelName: process.env[ENV_MODEL] || 'qwen-max',
        includeUsage: true,
      },
    })

    const messagesWithAttachments = adjustedMessages ?? messages

    console.log(
      `[Skill Workbench] ${messagesWithAttachments.length} messages, conversationId=${conversationId}`,
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
              const newAssistantMessages = completedMessages.slice(messagesWithAttachments.length)
              const messagesToSave = [...messages, ...newAssistantMessages]

              const costSummary = sessionState.costTracker.getSummary()
              console.log(
                `[Skill Workbench] Cost: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
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

              // 自动重载 context，使新创建/修改的 skill 在下一轮可用
              await reloadServerContext()
              console.log('[Skill Workbench] Context reloaded after agent turn')
            } catch (err) {
              console.error('[Skill Workbench] onFinish error:', err)
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
    console.error('[Skill Workbench] POST error:', error)
    return c.json({ error: 'Failed to process workbench request' }, 500)
  }
})

// GET /chat — 加载工作台对话历史
app.get('/chat', async (c) => {
  try {
    const conversationId = c.req.query('conversationId')
    if (!conversationId) {
      return c.json({ error: 'Missing conversationId' }, 400)
    }

    const store = await getServerDataStore()
    const messages = store.messageStore.getMessagesByConversation(conversationId)
    return c.json({ messages })
  } catch (error) {
    console.error('[Skill Workbench] GET error:', error)
    return c.json({ error: 'Failed to load messages' }, 500)
  }
})

// PATCH /chat — 保存工作台对话消息
app.patch('/chat', async (c) => {
  try {
    const body = await c.req.json<{ conversationId: string; messages: UIMessage[] }>()
    if (!body.conversationId || !body.messages) {
      return c.json({ error: 'Missing conversationId or messages' }, 400)
    }

    const store = await getServerDataStore()
    store.messageStore.saveMessages(body.conversationId, body.messages)
    return c.json({ success: true })
  } catch (error) {
    console.error('[Skill Workbench] PATCH error:', error)
    return c.json({ error: 'Failed to save messages' }, 500)
  }
})

// GET /detect — 检测最近修改的 skill
app.get('/detect', async (c) => {
  try {
    const runtime = await getServerRuntime()
    const skillsDirs = runtime.layout.resources.skills
    const skillsDir = skillsDirs[skillsDirs.length - 1]

    try {
      await fs.access(skillsDir)
    } catch {
      return c.json({ skillName: null })
    }

    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    let latestName: string | null = null
    let latestTime = 0

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dirPath = path.join(skillsDir, entry.name)
      const stat = await fs.stat(dirPath)
      if (stat.mtimeMs > latestTime) {
        latestTime = stat.mtimeMs
        latestName = entry.name
      }
    }

    return c.json({ skillName: latestName })
  } catch (error) {
    console.error('[Skill Workbench] Detect error:', error)
    return c.json({ skillName: null })
  }
})

export default app
