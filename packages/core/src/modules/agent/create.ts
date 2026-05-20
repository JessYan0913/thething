// ============================================================
// Agent Create - 统一的 Chat Agent 创建入口
// ============================================================

import { ToolLoopAgent, wrapLanguageModel } from 'ai'
import { createSessionState } from '../session'
import { createLanguageModel, createModelProvider } from '../../services/model'
import { createAgentPipeline, createDefaultStopConditions } from '../agent-control'
import { telemetryMiddleware, costTrackingMiddleware } from '../middleware'
import { loadAllTools } from './tools'
import { checkInitialBudget } from '../compaction/budget-check'
import { formatEstimationResult } from '../compaction/token-counter'
import { DEFAULT_COMPACTION_CONFIG } from '../compaction/types'
import { logger } from '../../primitives/logger'
import type { CompactionConfig } from '../compaction/types'
import {
  injectMessageAttachments,
  clearMessageAttachmentState,
} from '../../modules/attachments'
import { getPrimaryMemoryDir } from '../../modules/memory'
import type { CreateAgentConfig, CreateAgentResult, MemoryContext } from './types'

export async function createChatAgent(config: CreateAgentConfig): Promise<CreateAgentResult> {
  const {
    conversationId,
    messages,
    userId = 'default',
    conversationMeta,
    writerRef,
    webSearchApiKey,
    debugEnabled,
    preloadedData,
    resolvedConfig,
  } = config

  // 从 resolvedConfig 取配置 — 不再逐字段从白名单重建
  const { modelConfig, modules, sessionOptions, behavior, layout } = resolvedConfig

  const dataStore = preloadedData.dataStore

  // 判断是否是首次对话
  const isTurnZero = conversationMeta?.isNewConversation ?? false

  // 使用 preloadedData（来自 AppContext 快照），不再有 loadAll fallback
  const projectRoot = sessionOptions.projectRoot ?? preloadedData.layout.resourceRoot
  const memoryBaseDir = getPrimaryMemoryDir(preloadedData.layout)

  // ============================================================
  // ✅ 技能附件注入（由 core 内部处理）
  // ============================================================
  // 如果是新对话，清除旧的附件状态
  if (isTurnZero) {
    clearMessageAttachmentState(conversationId)
  }

  // 注入技能附件
  let messagesWithAttachments = messages || []
  let attachmentInfo = { hasSkillListing: false, skillListingCount: 0 }

  if (modules.skills && messages && messages.length > 0) {
    const attachmentResult = await injectMessageAttachments(messages, {
      sessionKey: conversationId,
      skills: preloadedData.skills,
      contextWindowTokens: sessionOptions.maxContextTokens ?? 128_000,
    })
    messagesWithAttachments = attachmentResult.messages
    attachmentInfo = {
      hasSkillListing: attachmentResult.hasSkillListing,
      skillListingCount: attachmentResult.skillListingCount,
    }

    // 记录附件注入结果
    if (attachmentResult.hasSkillListing) {
      logger.debug(
        'Attachments',
        `Injected: skill_listing=${attachmentResult.skillListingCount}`,
      )
    }
  }

  const sessionState = createSessionState(conversationId, {
    ...sessionOptions,
    model: modelConfig.modelName ?? sessionOptions.model,
    dataStore,
    modelAliases: behavior.modelAliases,
  })

  // Parallelize memory context and project context loading
  const { loadProjectContext } = await import('../../modules/system-prompt/sections/project-context')

  const [memoryContext, projectContext] = await Promise.all([
    (async () => {
      if (!modules.memory || messagesWithAttachments.length === 0) return null
      const { loadMemoryContext } = await import('./context/memory-context')
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

  const { buildAgentInstructions } = await import('./context/instructions')

  const instructions = await buildAgentInstructions(memoryContext, {
    cwd: projectRoot,
    memoryBaseDir,
    skills: preloadedData.skills,
    permissions: modules.permissions ? preloadedData.permissions : [],
    memoryEntries: preloadedData.memory,
    projectContext,
    conversationMeta,
  })

  const modelInstance = createLanguageModel(modelConfig)
  const provider = createModelProvider(modelConfig)

  // 设置 compactBeforeStep 所需的模型引用
  sessionState.compactModel = modelInstance

  const wrappedModel = wrapLanguageModel({
    model: modelInstance,
      middleware: [
        telemetryMiddleware({ debugEnabled }),
        costTrackingMiddleware(sessionState.costTracker),
      ],
  })

  const { tools, mcpRegistry } = await loadAllTools({
    conversationId,
    sessionState,
    enableMcp: modules.mcps,
    enableConnector: modules.connectors,
    connectorRegistry: preloadedData.connectorRegistry,
    writerRef,
    model: wrappedModel,
    provider,
    skills: preloadedData.skills,
    agents: preloadedData.agents,
    mcps: preloadedData.mcps,
    webSearchApiKey,
    debugEnabled,
    modelAliases: behavior.modelAliases,
    dynamicReload: resolvedConfig.dynamicReload,
  })

  // ============================================================
  // ✅ 初始预算检查
  // ============================================================
  const modelName = modelConfig.modelName || behavior.modelAliases.default
  const compactionConfig: CompactionConfig = sessionOptions.compactionConfig ?? DEFAULT_COMPACTION_CONFIG
  const budgetCheck = await checkInitialBudget(
    messagesWithAttachments,
    instructions,
    tools,
    modelName,
    compactionConfig,
    {
      dataStore,
      conversationId,
      model: modelInstance,
    },
  )

  // 记录预算检查结果
  logger.debug('AgentCreate', formatEstimationResult(budgetCheck.estimation))

  if (budgetCheck.actions.length > 0) {
    logger.debug('AgentCreate', `Budget adjustments: ${budgetCheck.actions.join(', ')}`)
  }

  // 如果仍未通过（极端情况），记录警告但继续执行
  if (!budgetCheck.passed) {
    logger.warn(
      'AgentCreate',
      `Budget check failed after all strategies. ` +
      `Request may still fail with context limit error.`
    )
  }

  // 使用调整后的工具（如果有调整）
  const finalTools = budgetCheck.adjustedTools ?? tools

  // 使用调整后的消息（如果有调整）
  const finalMessages = budgetCheck.adjustedMessages ?? messagesWithAttachments

  type ChatToolsType = Record<string, any>

  // 从 behavior 取值（消除硬编码）
  const maxSteps = behavior.maxStepsPerSession

  const prepareStep = createAgentPipeline<ChatToolsType>({
    sessionState,
    maxSteps,
    debugEnabled,
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
  // dispose 实现：释放对话资源
  // ============================================================
  const createDispose = () => {
    return async (options?: { waitForCompaction?: boolean }): Promise<void> => {
      // 1. 持久化成本数据
      await sessionState.costTracker.persistToDB()

      // 2. 断开 MCP 连接
      if (mcpRegistry) {
        await mcpRegistry.disconnectAll().catch((e) =>
          logger.warn('AgentHandle.dispose', 'MCP disconnect error:', e)
        )
      }

      logger.debug('AgentHandle.dispose', `Completed for ${conversationId}`)
    }
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
    attachmentInfo,
    dispose: createDispose(),
  }
}
