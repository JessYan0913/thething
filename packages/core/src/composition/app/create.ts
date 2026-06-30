// ============================================================
// App Create - Agent 创建入口
// ============================================================
// 合并原 composition/app/create.ts（配置解析）+ modules/agent/create.ts（组装编排），
// 让组装逻辑正确归属于 composition 层。

import { ToolLoopAgent, wrapLanguageModel } from 'ai'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'
import type { SubAgentStreamWriter } from '../../modules/agent'
import type { CompactionConfig } from '../../modules/compaction/types'
import type { CreateAgentOptions, CreateAgentResult } from './types'
import { resolveAgentConfig } from './resolve-agent-config'
import { createSessionState } from '../../modules/session'
import { createLanguageModel, createModelProvider } from '../../services/model'
import { createAgentPipeline, createDefaultStopConditions } from '../../modules/agent-control'
import { telemetryMiddleware, costTrackingMiddleware } from '../../modules/middleware'
import { loadAllTools } from '../../modules/agent/tools'
import { checkInitialBudget } from '../../modules/compaction/budget-check'
import { formatEstimationResult } from '../../modules/compaction/token-counter'
import { compactBeforeStep } from '../../modules/compaction'
import { DEFAULT_COMPACTION_CONFIG } from '../../modules/compaction/types'
import type { AgentDefinition } from '../../modules/agent/types'
import { resolveModelAlias } from '../../services/model/alias'
import { logger } from '../../primitives/logger'
import { getPrimaryWikiDir } from '../../modules/wiki'
import { loadWikiContextForAgent } from '../../modules/agent/context/wiki-context'
import type { McpRegistry, McpServerConfig } from '../../modules/mcp'

/**
 * 构建 MCP 工具列表文本，注入系统提示供 Agent 直接查看可用工具。
 */
function formatMcpServerTools(
  mcps: readonly McpServerConfig[],
  mcpRegistry?: McpRegistry,
): string | undefined {
  if (!mcps || mcps.length === 0) return undefined

  const lines: string[] = []
  const maxDescLen = 80

  if (mcpRegistry) {
    const snapshot = mcpRegistry.snapshot()
    for (const server of snapshot.servers) {
      const toolCount = server.tools.length
      lines.push(`📡 ${server.name}${!server.connected && toolCount === 0 ? ' (connecting...)' : ''}`)
      for (const tool of server.tools) {
        const desc = tool.description
          ? ` — ${tool.description.length > maxDescLen ? tool.description.slice(0, maxDescLen - 3) + '…' : tool.description}`
          : ''
        lines.push(`   ├─ ${tool.name}${desc}`)
      }
    }
  } else {
    for (const mcp of mcps) {
      lines.push(`📡 ${mcp.name} (not connected)`)
    }
  }

  return lines.join('\n')
}

/**
 * 创建 Agent。消费 AppContext，不再内部重新加载资源。
 *
 * 设计约束：
 * - 必须提供 context（已加载配置快照）
 * - model 参数必填（不从环境变量隐式读取）
 * - 不调用 loadAll（资源已在 context 中）
 * - 不修改全局状态
 */
export async function createAgent(options: CreateAgentOptions): Promise<CreateAgentResult> {
  const { context, conversationId, messages = [], userId = 'default' } = options

  // 统一解析配置
  const resolved = resolveAgentConfig(options)
  const { modelConfig, modules, sessionOptions, behavior, layout } = resolved

  const dataStore = context.runtime.dataStore

  const projectRoot = sessionOptions.projectRoot ?? context.layout.resourceRoot
  const wikiBaseDir = getPrimaryWikiDir(context.layout)

  // ============================================================
  // Agent 定义查找（如果指定了 agentType）
  // ============================================================
  let selectedAgentDef: AgentDefinition | undefined
  if (options.agentType) {
    selectedAgentDef = context.agents.find(
      (a) => a.agentType === options.agentType,
    )
    if (selectedAgentDef) {
      logger.debug(
        'AgentCreate',
        `Using agent definition: ${selectedAgentDef.agentType} (${selectedAgentDef.displayName ?? selectedAgentDef.agentType})`,
      )
    } else {
      logger.warn(
        'AgentCreate',
        `Agent type "${options.agentType}" not found, using default behavior`,
      )
    }
  }

  // ============================================================
  // 技能信息改为通过 Skill 工具的 skill: "list" 模式主动拉取
  // ============================================================
  const messagesWithAttachments = messages

  // ============================================================
  // Session 状态
  // ============================================================
  const sessionState = createSessionState(conversationId, {
    ...sessionOptions,
    model: modelConfig.modelName ?? sessionOptions.model,
    dataStore,
    modelAliases: behavior.modelAliases,
  })

  // ============================================================
  // 并行加载 wiki + project context
  // ============================================================
  const { loadProjectContext } = await import('../../modules/system-prompt/sections/project-context')

  const [wikiContext, projectContext] = await Promise.all([
    (async () => {
      if (messagesWithAttachments.length === 0) return null
      return loadWikiContextForAgent(messagesWithAttachments, userId, wikiBaseDir)
    })(),
    loadProjectContext(projectRoot, {
      contextFileNames: layout.contextFileNames,
      configDir: layout.configDir,
    }),
  ])

  // ============================================================
  // Instructions
  // ============================================================
  const { buildAgentInstructions } = await import('../../modules/agent/context/instructions')

  // wiki 上下文：只要有 userId 就注入 wiki guidelines prompt，
  // recalledContent 为空只表示没有已召回的页面，不影响 guidelines 注入
  const wikiPromptContext = userId
    ? { userId, recalledContent: wikiContext?.recalledContent || '' }
    : null

  // 构建 MCP 工具列表文本，让 Agent 在系统提示中直接看到可用工具
  const mcpServerTools = formatMcpServerTools(context.mcps, context.mcpRegistry)

  const instructions = await buildAgentInstructions(wikiPromptContext, {
    cwd: projectRoot,
    wikiBaseDir,
    skills: [...context.skills],
    permissions: modules.permissions ? [...context.permissions] : [],
    projectContext,
    conversationMeta: options.conversationMeta ? {
      messageCount: messages.length,
      isNewConversation: options.conversationMeta.isNewConversation,
      conversationStartTime: options.conversationMeta.conversationStartTime ?? Date.now(),
    } : undefined,
    mcpServerTools,
    // 合并 agent 定义的 instructions 和传入的 customInstructions
    customInstructions: [selectedAgentDef?.instructions, options.customInstructions].filter(Boolean).join('\n\n'),
    // 当选择自定义 Agent 时，跳过默认 identity section
    excludeSections: selectedAgentDef ? ['identity'] : undefined,
  })

  // ============================================================
  // Model + compact 注入
  // ============================================================
  // 如果 Agent 定义了非 'inherit' 的模型，覆盖 modelName
  if (selectedAgentDef?.model && selectedAgentDef.model !== 'inherit') {
    const agentModel = selectedAgentDef.model
    const resolvedModel = typeof agentModel === 'string'
      ? resolveModelAlias(agentModel, behavior.modelAliases)
      : agentModel
    if (typeof resolvedModel === 'string' && resolvedModel) {
      modelConfig.modelName = resolvedModel
      logger.debug('AgentCreate', `Model overridden by agent: ${resolvedModel}`)
    }
  }

  const modelInstance = createLanguageModel(modelConfig)
  const provider = createModelProvider(modelConfig)

  sessionState.compactModel = modelInstance

  const compactionCfg: CompactionConfig = sessionOptions.compactionConfig ?? DEFAULT_COMPACTION_CONFIG

  const wrappedModel = wrapLanguageModel({
    model: modelInstance,
    middleware: [
      telemetryMiddleware({ debugEnabled: Boolean(context.runtime.env.DEBUG) }),
      costTrackingMiddleware(sessionState.costTracker),
    ] as LanguageModelMiddleware[],
  }) as unknown as LanguageModel

  // ============================================================
  // Tools
  // ============================================================
  const { tools, mcpRegistry } = await loadAllTools({
    conversationId,
    sessionState,
    enableMcp: modules.mcps,
    enableConnector: modules.connectors,
    connectorRegistry: context.runtime.connectorRegistry,
    writerRef: options.writerRef as { current: SubAgentStreamWriter | null } | undefined,
    model: wrappedModel,
    provider,
    skills: [...context.skills],
    agents: [...context.agents],
    mcps: [...context.mcps],
    mcpRegistry: context.mcpRegistry,
    debugEnabled: Boolean(context.runtime.env.DEBUG),
    modelAliases: behavior.modelAliases,
    dynamicReload: resolved.dynamicReload,
    cronStore: context.runtime.cronStore ?? undefined,
    tasksDir: context.runtime.tasksDir,
    userId,
    wikiBaseDir,
  })

  // 如果 Agent 定义了工具限制，过滤工具集
  let filteredTools = tools
  if (selectedAgentDef) {
    const allowedTools = selectedAgentDef.tools
    const disallowedTools = selectedAgentDef.disallowedTools

    if (allowedTools && allowedTools.length > 0) {
      // 支持 '*' 通配符，表示允许所有工具
      if (allowedTools.includes('*')) {
        logger.debug('AgentCreate', `Tools: wildcard '*' allows all tools`)
      } else {
        filteredTools = Object.fromEntries(
          Object.entries(tools).filter(([name]) => allowedTools.includes(name)),
        )
        logger.debug('AgentCreate', `Tools filtered by allowlist: ${Object.keys(filteredTools).join(', ')}`)
      }
    }

    if (disallowedTools && disallowedTools.length > 0) {
      filteredTools = Object.fromEntries(
        Object.entries(filteredTools).filter(([name]) => !disallowedTools.includes(name)),
      )
      logger.debug('AgentCreate', `Tools filtered by blocklist: ${Object.keys(filteredTools).join(', ')}`)
    }
  }

  // ============================================================
  // 初始预算检查
  // ============================================================
  const modelName = modelConfig.modelName || behavior.modelAliases.default?.model
  const budgetCheck = await checkInitialBudget(
    messagesWithAttachments,
    instructions,
    filteredTools,
    modelName,
    compactionCfg,
    {
      dataStore,
      conversationId,
      model: modelInstance,
      contextLimit: sessionOptions.maxContextTokens,
    },
  )

  logger.debug('AgentCreate', formatEstimationResult(budgetCheck.estimation))

  if (budgetCheck.actions.length > 0) {
    logger.debug('AgentCreate', `Budget adjustments: ${budgetCheck.actions.join(', ')}`)
  }

  if (!budgetCheck.passed) {
    logger.warn(
      'AgentCreate',
      `Budget check failed after all strategies. ` +
      `Request may still fail with context limit error.`,
    )
  }

  const finalTools = budgetCheck.adjustedTools ?? filteredTools
  const finalMessages = budgetCheck.adjustedMessages ?? messagesWithAttachments

  if (options.autoApprove) {
    for (const name of Object.keys(finalTools)) {
      finalTools[name] = { ...finalTools[name], needsApproval: undefined }
    }
  }

  // ============================================================
  // Compact 注入（在 budget check + finalTools 之后，使用真实 overhead）
  // ============================================================
  const overheadInstructions = budgetCheck.estimation.instructionsTokens
  const overheadTools = budgetCheck.estimation.toolsTokens

  sessionState.compact = async (msgs) => {
    if (sessionState.compactModel && sessionState.dataStore) {
      const afterResult = await compactBeforeStep(msgs, sessionState, compactionCfg, {
        model: sessionState.compactModel,
        fallbackModels: sessionState.fallbackModels,
        modelName: sessionState.model,
        conversationId,
        dataStore: sessionState.dataStore,
        contextLimit: sessionOptions.maxContextTokens,
        instructionsTokens: overheadInstructions,
        toolsTokens: overheadTools,
      })
      const tokensFreed = await estimateTokensDiff(msgs, afterResult)
      return {
        messages: afterResult,
        executed: tokensFreed > 0,
        tokensFreed,
        actions: tokensFreed > 0 ? [`compactBeforeStep: freed ${tokensFreed} tokens`] : [],
      }
    }
    const { manageToolOutputLifecycle } = await import('../../modules/compaction/lifecycle')
    const result = manageToolOutputLifecycle(msgs, compactionCfg.lifecycle)
    return {
      messages: result.messages,
      executed: result.tokensFreed > 0,
      tokensFreed: result.tokensFreed,
      actions: result.tokensFreed > 0 ? [`Layer 2: freed ${result.tokensFreed} tokens`] : [],
    }
  }

  // ============================================================
  // Agent pipeline + ToolLoopAgent
  // ============================================================
  type ChatToolsType = Record<string, any>
  const maxSteps = behavior.maxStepsPerSession

  const prepareStep = createAgentPipeline<ChatToolsType>({
    sessionState,
    maxSteps,
    debugEnabled: Boolean(context.runtime.env.DEBUG),
    instructions,
    tools: finalTools,
    contextLimit: sessionOptions.maxContextTokens,
    triggerPercent: compactionCfg.contextWindow.triggerPercent,
  })

  const stopWhen = createDefaultStopConditions<ChatToolsType>(sessionState.costTracker, {
    maxSteps,
    denialTracker: sessionState.denialTracker,
    sessionState,
  })

  const agent = new ToolLoopAgent({
    model: wrappedModel,
    instructions,
    tools: finalTools,
    prepareStep,
    stopWhen,
    toolChoice: 'auto',
  })

  // ============================================================
  // dispose
  // ============================================================
  const dispose = async (_options?: { waitForCompaction?: boolean }): Promise<void> => {
    await sessionState.costTracker.persistToDB()
    if (mcpRegistry) {
      await mcpRegistry.disconnectAll().catch((e) =>
        logger.warn('AgentHandle.dispose', 'MCP disconnect error:', e),
      )
    }
    logger.debug('AgentHandle.dispose', `Completed for ${conversationId}`)
  }

  return {
    agent,
    sessionState,
    mcpRegistry,
    tools: finalTools,
    instructions,
    adjustedMessages: finalMessages,
    budgetActions: budgetCheck.actions,
    model: modelInstance,
    wikiBaseDir,
    dispose,
  }
}

async function estimateTokensDiff(before: import('ai').UIMessage[], after: import('ai').UIMessage[]): Promise<number> {
  try {
    const { estimateMessagesTokens } = await import('../../modules/compaction/token-counter')
    const beforeTokens = await estimateMessagesTokens(before)
    const afterTokens = await estimateMessagesTokens(after)
    return Math.max(0, beforeTokens - afterTokens)
  } catch {
    return 0
  }
}
