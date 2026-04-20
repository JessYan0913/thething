// ============================================================
// Chat Command - Interactive multi-turn conversation
// ============================================================

import chalk from 'chalk'
import { nanoid } from 'nanoid'
import { createRepl, startRepl } from '../interactive/repl'
import { getDataDirConfig } from '../lib/data-dir'
import {
  initAll,
  createChatAgent,
  getGlobalDataStore,
  generateConversationTitle,
  createLanguageModel,
} from '@thething/core'
import { createAgentUIStream, type UIMessage } from 'ai'

export interface ChatOptions {
  conversation?: string
  model?: string
}

export default async function chat(options: ChatOptions): Promise<void> {
  // Initialize all systems
  const dataDirConfig = getDataDirConfig()
  await initAll({ dataDir: dataDirConfig.dataDir })

  // Get datastore
  const store = getGlobalDataStore()

  // Get or create conversation
  let conversationId = options.conversation

  if (!conversationId) {
    conversationId = nanoid()
    store.conversationStore.createConversation(conversationId, 'CLI Chat')
  } else {
    const existingMessages = store.messageStore.getMessagesByConversation(conversationId)
    if (existingMessages.length > 0) {
      console.log(chalk.dim(`Loaded: ${conversationId} (${existingMessages.length} messages)`))
    } else {
      conversationId = nanoid()
      store.conversationStore.createConversation(conversationId, 'CLI Chat')
    }
  }

  // Store messages
  let messages: UIMessage[] = store.messageStore.getMessagesByConversation(conversationId)

  // Model configuration
  const modelName = options.model || process.env.DASHSCOPE_MODEL || 'qwen-max'
  const enableThinking = process.env.DASHSCOPE_ENABLE_THINKING === 'true'

  // Create REPL
  const rl = createRepl({
    onInput: async (input: string) => {
      // Create user message
      const userMessage: UIMessage = {
        id: nanoid(),
        role: 'user',
        parts: [{ type: 'text', text: input }],
      }

      messages = [...messages, userMessage]

      // Create agent using unified createChatAgent
      const { agent, sessionState, mcpRegistry } = await createChatAgent({
        conversationId: conversationId!,
        messages,
        modelConfig: {
          apiKey: process.env.DASHSCOPE_API_KEY!,
          baseURL: process.env.DASHSCOPE_BASE_URL!,
          modelName,
          includeUsage: true,
          enableThinking,
        },
        conversationMeta: {
          messageCount: messages.length,
          isNewConversation: messages.length === 1,
          conversationStartTime: Date.now(),
        },
        enableMcp: true,
        enableSkills: true,
        enableMemory: true,
        enableConnector: true,
      })

      // Stream response
      const abortController = new AbortController()

      try {
        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: messages,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            // Save messages
            const newMessages = [...messages, ...completedMessages.slice(messages.length)]
            store.messageStore.saveMessages(conversationId!, newMessages)
            messages = newMessages

            // Generate title for new conversations
            const conversation = store.conversationStore.getConversation(conversationId!)
            if (conversation && conversation.title === 'CLI Chat') {
              const modelInstance = createLanguageModel({
                apiKey: process.env.DASHSCOPE_API_KEY!,
                baseURL: process.env.DASHSCOPE_BASE_URL!,
                modelName,
                includeUsage: true,
                enableThinking,
              })
              generateConversationTitle(newMessages, modelInstance)
                .then(title => {
                  store.conversationStore.updateConversationTitle(conversationId!, title)
                })
                .catch(() => {
                  const firstUserText = newMessages
                    .find(m => m.role === 'user')
                    ?.parts.filter(p => p.type === 'text')
                    .map(p => p.type === 'text' ? p.text : '')
                    .join('')
                    .trim()
                    .slice(0, 20) || 'New Chat'
                  store.conversationStore.updateConversationTitle(conversationId!, firstUserText)
                })
            }

            // Disconnect MCP
            if (mcpRegistry) {
              await mcpRegistry.disconnectAll()
            }

            // Log cost
            const costSummary = sessionState.costTracker.getSummary()
            console.log()
            console.log(chalk.gray(`Cost: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`))
          },
        })

        // Process stream
        let isReasoning = false
        for await (const chunk of agentStream) {
          if (chunk.type === 'text-delta') {
            if (isReasoning) {
              process.stdout.write(chalk.gray('\n────────────────────────────────────────\n'))
              process.stdout.write(chalk.green('Assistant: '))
              isReasoning = false
            }
            process.stdout.write(chunk.delta || '')
          } else if (chunk.type === 'reasoning-start') {
            process.stdout.write(chalk.gray('\n💭 Thinking...\n────────────────────────────────────────\n'))
            isReasoning = true
          } else if (chunk.type === 'reasoning-delta') {
            process.stdout.write(chalk.gray(chunk.delta || ''))
          }
        }
      } catch (error) {
        if (mcpRegistry) {
          try { await mcpRegistry.disconnectAll() } catch {}
        }
        if (error instanceof Error && error.message.includes('abort')) {
          console.log(chalk.yellow('\nGeneration cancelled.'))
        } else {
          console.log(chalk.red('\nError:'), error instanceof Error ? error.message : String(error))
        }
      }
    },

    onCommand: async (command: string) => {
      const cmd = command.toLowerCase()

      if (cmd === '/exit' || cmd === '/quit') {
        console.log(chalk.yellow('Exiting chat...'))
        return false
      }

      if (cmd === '/clear') {
        messages = []
        console.log(chalk.blue('Conversation cleared.'))
        return true
      }

      if (cmd.startsWith('/model ')) {
        const newModel = command.slice(7).trim()
        console.log(chalk.blue(`Model set to: ${newModel}`))
        return true
      }

      if (cmd === '/history') {
        console.log(chalk.blue(`Conversation: ${conversationId}`))
        console.log(chalk.gray(`Messages: ${messages.length}`))
        for (const msg of messages.slice(-5)) {
          const preview = msg.parts
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join('')
            .slice(0, 50)
          console.log(chalk.gray(`  ${msg.role}: ${preview}${preview.length >= 50 ? '...' : ''}`))
        }
        return true
      }

      console.log(chalk.yellow(`Unknown command: ${command}`))
      console.log(chalk.gray('Available: /clear, /exit, /history, /model <name>'))
      return true
    },

    onCancel: () => {
      // Signal abort
    },
  })

  startRepl(rl)
}