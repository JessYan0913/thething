import os from 'os'
import path from 'path'
import chalk from 'chalk'
import * as readline from 'readline'
import { nanoid } from 'nanoid'
import { render } from 'ink'
import React from 'react'
import { getDataDirConfig } from '../lib/data-dir.js'
import { loadConfig, saveConfig, type GlobalConfig } from '../lib/config-store.js'
import { bootstrap, createContext, resolveProjectDir } from '@the-thing/core'
import { ENV_MODEL } from '../lib/env-names.js'
import { App } from '../interactive/App.js'

export interface ChatOptions {
  conversation?: string
  model?: string
}

function questionBool(rl: readline.Interface, prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const normalized = answer.trim().toLowerCase()
      resolve(normalized === 'y' || normalized === 'yes' || normalized === '是')
    })
  })
}

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
    console.log(chalk.yellow('请输入 API Base URL（例如: https://dashscope.aliyuncs.com/compatible-mode/v1 或 https://api.deepseek.com/v1）'))
    const baseURL = await question(chalk.cyan('Base URL: '))
    if (!baseURL.trim()) {
      console.log(chalk.red('Base URL 不能为空'))
      rl.close()
      return null
    }

    console.log(chalk.yellow('\n请输入 API Key'))
    const apiKey = await question(chalk.cyan('API Key: '))
    if (!apiKey.trim()) {
      console.log(chalk.red('API Key 不能为空'))
      rl.close()
      return null
    }

    console.log(chalk.yellow('\n请输入默认模型名称（可选，直接回车使用 qwen-max）'))
    const model = await question(chalk.cyan('Model: '))
    const modelName = model.trim() || 'qwen-max'

    rl.close()

    const config: GlobalConfig = {
      apiKey: apiKey.trim(),
      baseURL: baseURL.trim(),
      modelAliases: { default: { model: modelName }, fast: { model: modelName }, smart: { model: modelName } },
    }

    saveConfig(config)
    console.log(chalk.green('\n✅ 配置已保存到 ~/.agents/models.json'))
    console.log(chalk.gray(`   Base URL: ${config.baseURL}`))
    console.log(chalk.gray(`   Model: ${config.modelAliases?.default?.model}\n`))

    return config
  } catch (error) {
    rl.close()
    console.log(chalk.red('\n配置过程中出现错误'))
    return null
  }
}

async function ensureConfig(fileConfig?: GlobalConfig): Promise<{ apiKey: string; baseURL: string; modelName: string } | null> {
  fileConfig = fileConfig ?? loadConfig()
  const apiKey = process.env.THETHING_API_KEY || fileConfig.apiKey
  const baseURL = process.env.THETHING_BASE_URL || fileConfig.baseURL
  const modelName = process.env[ENV_MODEL] || fileConfig.modelAliases?.default?.model || 'qwen-max'

  if (apiKey && baseURL) {
    return { apiKey, baseURL, modelName }
  }

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
      modelName: newConfig.modelAliases?.default?.model || 'qwen-max',
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
  const origEmitWarning = process.emitWarning
  process.emitWarning = ((...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('punycode')) return
    return origEmitWarning.apply(process, args as any)
  }) as typeof process.emitWarning

  const dataDirConfig = getDataDirConfig()
  const fileConfig = loadConfig()
  const envSnapshot: Record<string, string | undefined> = { ...process.env }

  if (fileConfig.apiKey && !envSnapshot.THETHING_API_KEY) {
    envSnapshot.THETHING_API_KEY = fileConfig.apiKey
  }
  if (fileConfig.baseURL && !envSnapshot.THETHING_BASE_URL) {
    envSnapshot.THETHING_BASE_URL = fileConfig.baseURL
  }
  if (fileConfig.modelAliases?.default?.model && !envSnapshot[ENV_MODEL]) {
    envSnapshot[ENV_MODEL] = fileConfig.modelAliases.default.model
  }

  const cwd = resolveProjectDir({
    monorepoPatterns: ['packages/app', 'packages/cli'],
  })

  const runtime = await bootstrap({
    layout: {
      resourceRoot: cwd,
      configDir: path.join(os.homedir(), '.agents'),
      dataDir: dataDirConfig.dataDir,
    },
    env: envSnapshot,
  })

  const context = await createContext({ runtime })

  const configResult = await ensureConfig(fileConfig)
  if (!configResult) {
    await runtime.dispose()
    return
  }

  const modelName = options.model || configResult.modelName
  const enableThinking = process.env.THETHING_ENABLE_THINKING === 'true'

  const { waitUntilExit } = render(
    <App
      runtime={runtime}
      context={context}
      store={runtime.dataStore}
      initialConversationId={options.conversation || nanoid()}
      initialModel={modelName}
      apiKey={configResult.apiKey}
      baseURL={configResult.baseURL}
      enableThinking={enableThinking}
    />,
    { exitOnCtrlC: false },
  )

  const origLog = console.log
  const origWarn = console.warn
  const origError = console.error
  const suppress = /\[ConnectorRegistry\]|\[TitleGenerator\]|DEP0040|punycode|APICallError|AI_APICallError/
  console.log = (...args: any[]) => {
    if (args.some(a => typeof a === 'string' && suppress.test(a))) return
    origLog(...args)
  }
  console.warn = (...args: any[]) => {
    if (args.some(a => typeof a === 'string' && suppress.test(a))) return
    origWarn(...args)
  }
  console.error = (...args: any[]) => {
    if (args.some(a => typeof a === 'string' && suppress.test(a))) return
    origError(...args)
  }

  await waitUntilExit()
  console.log = origLog
  console.warn = origWarn
  console.error = origError
  await runtime.dispose()
}
