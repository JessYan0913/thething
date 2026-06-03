// ============================================================
// App Create - Agent 创建入口
// ============================================================
// 合并原 composition/app/create.ts（配置解析）+ modules/agent/create.ts（组装编排），
// 让组装逻辑正确归属于 composition 层。

import { ToolLoopAgent, wrapLanguageModel } from 'ai'
import type { SubAgentStreamWriter } from '../../modules/subagents'
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
import type { AgentDefinition } from '../../modules/subagents/types'
import { resolveModelAlias } from '../../services/model/alias'
import { logger } from '../../primitives/logger'
import {
  injectMessageAttachments,
  clearMessageAttachmentState,
} from '../../modules/attachments'
import { getPrimaryMemoryDir } from '../../modules/memory'

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

  // 判断是否是首次对话
  const isTurnZero = options.conversationMeta?.isNewConversation ?? false

  const projectRoot = sessionOptions.projectRoot ?? context.layout.resourceRoot
  const memoryBaseDir = getPrimaryMemoryDir(context.layout)

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
  // 技能附件注入
  // ============================================================
  if (isTurnZero) {
    clearMessageAttachmentState(conversationId)
  }

  let messagesWithAttachments = messages
  if (modules.skills && messages.length > 0) {
    const attachmentResult = await injectMessageAttachments(messages, {
      sessionKey: conversationId,
      skills: [...context.skills],
      contextWindowTokens: sessionOptions.maxContextTokens ?? 128_000,
    })
    messagesWithAttachments = attachmentResult.messages

    if (attachmentResult.hasSkillListing) {
      logger.debug(
        'Attachments',
        `Injected: skill_listing=${attachmentResult.skillListingCount}`,
      )
    }
  }

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
  // 并行加载 memory + project context
  // ============================================================
  const { loadProjectContext } = await import('../../modules/system-prompt/sections/project-context')

  const [memoryContext, projectContext] = await Promise.all([
    (async () => {
      if (!modules.memory || messagesWithAttachments.length === 0) return null
      const { loadMemoryContext } = await import('../../modules/agent/context/memory-context')
      return loadMemoryContext(messagesWithAttachments, userId, memoryBaseDir, {
        entrypointMaxLines: behavior.memory.entrypointMaxLines,
        entrypointMaxBytes: behavior.memory.entrypointMaxBytes,
      })
    })(),
    loadProjectContext(projectRoot, {
      contextFileNames: layout.contextFileNames,
      configDirName: layout.configDirName,
    }),
  ])

  // ============================================================
  // Instructions
  // ============================================================
  const { buildAgentInstructions } = await import('../../modules/agent/context/instructions')

  const instructions = await buildAgentInstructions(memoryContext, {
    cwd: projectRoot,
    memoryBaseDir,
    skills: [...context.skills],
    permissions: modules.permissions ? [...context.permissions] : [],
    memoryEntries: [...context.memory],
    projectContext,
    conversationMeta: options.conversationMeta ? {
      messageCount: messages.length,
      isNewConversation: options.conversationMeta.isNewConversation,
      conversationStartTime: options.conversationMeta.conversationStartTime ?? Date.now(),
    } : undefined,
    customInstructions: selectedAgentDef?.instructions,
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
    ],
  })

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
  })

  // 如果 Agent 定义了工具限制，过滤工具集
  let filteredTools = tools
  if (selectedAgentDef) {
    const allowedTools = selectedAgentDef.tools
    const disallowedTools = selectedAgentDef.disallowedTools

    if (allowedTools && allowedTools.length > 0) {
      filteredTools = Object.fromEntries(
        Object.entries(tools).filter(([name]) => allowedTools.includes(name)),
      )
      logger.debug('AgentCreate', `Tools filtered by allowlist: ${Object.keys(filteredTools).join(', ')}`)
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
    memoryBaseDir,
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
