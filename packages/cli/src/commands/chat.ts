// ============================================================
// Chat Command - Interactive multi-turn conversation
// ============================================================

import chalk from 'chalk'
import * as readline from 'readline'
import { nanoid } from 'nanoid'
import { createRepl, startRepl } from '../interactive/repl'
import { getDataDirConfig } from '../lib/data-dir'
import { loadConfig, saveConfig, type GlobalConfig } from '../lib/config-store'
import {
  bootstrap,
  createContext,
  createAgent,
  generateConversationTitle,
  resolveProjectDir,
} from '@the-thing/core'
import { ENV_MODEL } from '../lib/env-names'
import { createAgentUIStream, type UIMessage } from 'ai'

export interface ChatOptions {
  conversation?: string
  model?: string
}

/**
 * Helper function for yes/no questions
 */
function questionBool(rl: readline.Interface, prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const normalized = answer.trim().toLowerCase()
      resolve(normalized === 'y' || normalized === 'yes' || normalized === '是')
    })
  })
}

/**
 * Interactive first-time setup wizard
 */
async function runSetupWizard(): Promise<GlobalConfig | null> {
  console.log(chalk.cyan('\n🚀 欢迎使用 TheThing CLI！'))
  console.log(chalk.gray('首次使用需要配置 API 连接信息。\n'))

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve)
    })
  }

  try {
    // Ask for baseURL
    console.log(chalk.yellow('请输入 API Base URL（例如: https://dashscope.aliyuncs.com/compatible-mode/v1 或 https://api.deepseek.com/v1）'))
    const baseURL = await question(chalk.cyan('Base URL: '))
    if (!baseURL.trim()) {
      console.log(chalk.red('Base URL 不能为空'))
      rl.close()
      return null
    }

    // Ask for API Key
    console.log(chalk.yellow('\n请输入 API Key'))
    const apiKey = await question(chalk.cyan('API Key: '))
    if (!apiKey.trim()) {
      console.log(chalk.red('API Key 不能为空'))
      rl.close()
      return null
    }

    // Ask for model (optional)
    console.log(chalk.yellow('\n请输入默认模型名称（可选，直接回车使用 qwen-max）'))
    const model = await question(chalk.cyan('Model: '))
    const modelName = model.trim() || 'qwen-max'

    rl.close()

    const config: GlobalConfig = {
      apiKey: apiKey.trim(),
      baseURL: baseURL.trim(),
      model: modelName,
    }

    // Save config
    saveConfig(config)
    console.log(chalk.green('\n✅ 配置已保存到 ~/.thething/config.json'))
    console.log(chalk.gray(`   Base URL: ${config.baseURL}`))
    console.log(chalk.gray(`   Model: ${config.model}\n`))

    return config
  } catch (error) {
    rl.close()
    console.log(chalk.red('\n配置过程中出现错误'))
    return null
  }
}

/**
 * Check config and run setup wizard if needed
 */
async function ensureConfig(fileConfig?: GlobalConfig): Promise<{ apiKey: string; baseURL: string; modelName: string } | null> {
  fileConfig = fileConfig ?? loadConfig()
  let apiKey = process.env.THETHING_API_KEY || fileConfig.apiKey
  let baseURL = process.env.THETHING_BASE_URL || fileConfig.baseURL
  let modelName = process.env[ENV_MODEL] || fileConfig.model || 'qwen-max'

  if (apiKey && baseURL) {
    return { apiKey, baseURL, modelName }
  }

  // Missing config - prompt for setup
  console.log(chalk.yellow('\n⚠️  未检测到 API 配置'))

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const shouldSetup = await questionBool(rl, '是否现在进行配置？(y/n): ')

  if (shouldSetup) {
    rl.close()
    const newConfig = await runSetupWizard()
    if (!newConfig?.apiKey || !newConfig?.baseURL) {
      return null
    }
    return {
      apiKey: newConfig.apiKey,
      baseURL: newConfig.baseURL,
      modelName: newConfig.model || 'qwen-max',
    }
  } else {
    rl.close()
    console.log(chalk.gray('\n你也可以稍后通过以下方式配置:'))
    console.log(chalk.gray('  thething config set apiKey <your-api-key>'))
    console.log(chalk.gray('  thething config set baseURL <your-base-url>'))
    console.log(chalk.gray('  thething config set model <model-name>'))
    console.log(chalk.gray('\n或设置环境变量:'))
    console.log(chalk.gray('  THETHING_API_KEY=<your-api-key>'))
    console.log(chalk.gray('  THETHING_BASE_URL=<your-base-url>'))
    return null
  }
}

export default async function chat(options: ChatOptions): Promise<void> {
  // ============================================================
  // Step 1: Bootstrap - 初始化基础设施
  // ============================================================
  const dataDirConfig = getDataDirConfig()
  const fileConfig = loadConfig()
  const envSnapshot: Record<string, string | undefined> = { ...process.env }

  // 从 config file 中读取并合并到 env 快照（bootstrap 用 runtime.env 做 connector ${VAR} 替换）
  if (fileConfig.apiKey && !envSnapshot.THETHING_API_KEY) {
    envSnapshot.THETHING_API_KEY = fileConfig.apiKey
  }
  if (fileConfig.baseURL && !envSnapshot.THETHING_BASE_URL) {
    envSnapshot.THETHING_BASE_URL = fileConfig.baseURL
  }
  if (fileConfig.model && !envSnapshot[ENV_MODEL]) {
    envSnapshot[ENV_MODEL] = fileConfig.model
  }

  const cwd = resolveProjectDir({
    monorepoPatterns: ['packages/server', 'packages/cli'],
  })

  // Bootstrap 时传入 env 快照，确保 connector ${VAR} 替换可用
  const runtime = await bootstrap({
    layout: {
      resourceRoot: cwd,
      dataDir: dataDirConfig.dataDir,
    },
    env: envSnapshot,
  })

  // Get datastore from runtime
  const store = runtime.dataStore

  // ============================================================
  // Step 2: CreateContext - 加载配置
  // ============================================================
  // cwd 自动从 layout.resourceRoot 取值
  const context = await createContext({ runtime })

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

  // Load config file and merge with environment variables（复用已读取的 fileConfig）
  const configResult = await ensureConfig(fileConfig)
  if (!configResult) {
    await runtime.dispose()
    return
  }

  // Override model if specified via CLI option
  const modelName = options.model || configResult.modelName
  const enableThinking = process.env.THETHING_ENABLE_THINKING === 'true'
  const apiKey = configResult.apiKey
  const baseURL = configResult.baseURL

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

      // ============================================================
      // Step 3: CreateAgent - 使用新 API
      // ============================================================
      const { agent, sessionState, mcpRegistry, model, adjustedMessages } = await createAgent({
        context,
        conversationId: conversationId!,
        messages,
        model: {
          apiKey,
          baseURL,
          modelName,
          includeUsage: true,
          enableThinking,
        },
      })

      // Stream response
      const abortController = new AbortController()

      try {
        // 使用调整后的消息（包含注入的附件）
        const messagesToStream = adjustedMessages ?? messages

        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: messagesToStream,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            // Save messages
            const newMessages = [...messages, ...completedMessages.slice(messagesToStream.length)]
            store.messageStore.saveMessages(conversationId!, newMessages)
            messages = newMessages

            // Generate title for new conversations
            const conversation = store.conversationStore.getConversation(conversationId!)
            if (conversation && conversation.title === 'CLI Chat') {
              generateConversationTitle(newMessages, model)
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
        await runtime.dispose()
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