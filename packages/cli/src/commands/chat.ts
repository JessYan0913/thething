// ============================================================
// Chat Command - Interactive multi-turn conversation
// ============================================================

import chalk from 'chalk'
import { nanoid } from 'nanoid'
import { createRepl, startRepl } from '../interactive/repl'
import { renderStreamText, createSpinner } from '../interactive/stream-output'
import { getDataDirConfig } from '../lib/data-dir'
import {
  configureDatabase,
  createConversation,
  getMessagesByConversation,
  saveMessages,
  listConversations,
  buildSystemPrompt,
  createSessionState,
  createAgentPipeline,
  createDefaultStopConditions,
  createModelProvider,
  bashTool,
  editFileTool,
  exaSearchTool,
  globTool,
  grepTool,
  readFileTool,
  writeFileTool,
  askUserQuestionTool,
  getGlobalTaskStore,
  createTaskToolsForConversation,
  costTrackingMiddleware,
  telemetryMiddleware,
  type SubAgentStreamWriter,
} from '@thething/core'
import {
  ToolLoopAgent,
  createAgentUIStream,
  wrapLanguageModel,
  type UIMessage,
  type Tool,
} from 'ai'

export interface ChatOptions {
  conversation?: string
  model?: string
}

export default async function chat(options: ChatOptions): Promise<void> {
  // Configure database
  const dataDirConfig = getDataDirConfig()
  configureDatabase({ dataDir: dataDirConfig.dataDir })

  // Get or create conversation
  let conversationId = options.conversation

  if (!conversationId) {
    // Create new conversation
    conversationId = nanoid()
    createConversation(conversationId, 'CLI Chat')
    console.log(chalk.blue(`Created new conversation: ${conversationId}`))
  } else {
    // Load existing conversation
    const messages = getMessagesByConversation(conversationId)
    if (messages.length > 0) {
      console.log(chalk.blue(`Loaded conversation: ${conversationId} (${messages.length} messages)`))
    } else {
      console.log(chalk.yellow(`Conversation ${conversationId} not found. Creating new.`))
      createConversation(conversationId, 'CLI Chat')
    }
  }

  // Store messages
  let messages: UIMessage[] = getMessagesByConversation(conversationId)

  // Model configuration
  const modelName = options.model || process.env.DASHSCOPE_MODEL || 'qwen-max'
  const dashscope = createModelProvider({
    apiKey: process.env.DASHSCOPE_API_KEY!,
    baseURL: process.env.DASHSCOPE_BASE_URL!,
    modelName,
    includeUsage: true,
  })

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

      // Create session state
      const sessionState = createSessionState(conversationId!, {
        maxContextTokens: 128_000,
        compactThreshold: 25_000,
        maxBudgetUsd: 5.0,
        model: modelName,
      })

      // Build system prompt
      const { prompt } = await buildSystemPrompt({
        includeProjectContext: false,
        conversationMeta: {
          messageCount: messages.length,
          isNewConversation: messages.length === 1,
          conversationStartTime: Date.now(),
        },
      })

      // Create model with middleware
      const wrappedModel = wrapLanguageModel({
        model: dashscope(sessionState.model),
        middleware: [telemetryMiddleware(), costTrackingMiddleware(sessionState.costTracker)],
      })

      // Create tools
      const tools: Record<string, Tool> = {
        web_search: exaSearchTool,
        read_file: readFileTool,
        write_file: writeFileTool,
        edit_file: editFileTool,
        bash: bashTool,
        grep: grepTool,
        glob: globTool,
        ask_user_question: askUserQuestionTool,
        ...createTaskToolsForConversation(getGlobalTaskStore(), conversationId!),
      }

      // Create agent pipeline
      const prepareStep = createAgentPipeline({
        sessionState,
        maxSteps: 50,
        maxBudgetUsd: 5.0,
      })

      const stopWhen = createDefaultStopConditions(sessionState.costTracker, {
        maxSteps: 50,
        denialTracker: sessionState.denialTracker,
        sessionState,
      })

      // Create agent
      const writerRef: { current: SubAgentStreamWriter | null } = { current: null }
      const agent = new ToolLoopAgent({
        model: wrappedModel,
        instructions: prompt,
        tools,
        prepareStep,
        stopWhen,
        toolChoice: 'auto',
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
            saveMessages(conversationId!, newMessages)
            messages = newMessages

            // Log cost
            const costSummary = sessionState.costTracker.getSummary()
            console.log()
            console.log(chalk.gray(`Cost: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`))
          },
        })

        // Process stream
        for await (const chunk of agentStream) {
          if (chunk.type === 'text-delta') {
            process.stdout.write(chunk.delta || '')
          }
        }
      } catch (error) {
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
        // Note: This would need to update sessionState
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