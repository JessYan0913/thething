// ============================================================
// Agent Create - 统一的 Chat Agent 创建入口
// ============================================================

import { ToolLoopAgent, wrapLanguageModel } from 'ai'
import { createSessionState } from '../session-state'
import { createLanguageModel, createModelProvider } from '../../foundation/model'
import { createAgentPipeline, createDefaultStopConditions } from '../agent-control'
import { telemetryMiddleware, costTrackingMiddleware } from '../middleware'
import { resolveActiveSkills, loadMemoryContext, buildAgentInstructions } from './context'
import { loadAllTools } from './tools'
import { checkInitialBudget } from '../compaction/initial-budget-check'
import { formatEstimationResult } from '../compaction/token-counter'
import { waitForConversationCompaction } from '../compaction/background-queue'
import { toRuntimeCompactionConfig } from '../compaction/types'
import { loadProjectContext } from '../../extensions/system-prompt/sections/project-context'
import {
  injectMessageAttachments,
  clearMessageAttachmentState,
} from '../../extensions/attachments'
import { getPrimaryMemoryDir } from '../../extensions/memory'
import type { CreateAgentConfig, CreateAgentResult, SkillResolution, MemoryContext } from './types'

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
      console.log(
        `[Attachments] Injected: skill_listing=${attachmentResult.skillListingCount}`,
      )
    }
  }

  const sessionState = createSessionState(conversationId, {
    ...sessionOptions,
    model: modelConfig.modelName ?? sessionOptions.model,
    dataStore,
    modelAliases: behavior.modelAliases,
  })

  let skillResolution: SkillResolution | null = null
  if (modules.skills && messagesWithAttachments.length > 0) {
    skillResolution = await resolveActiveSkills(messagesWithAttachments, preloadedData.skills)
    if (skillResolution?.activeModelOverride) {
      sessionState.model = skillResolution.activeModelOverride
    }
    if (skillResolution?.activeSkillNames) {
      for (const name of skillResolution.activeSkillNames) {
        sessionState.activeSkills.add(name)
      }
    }
  }

  let memoryContext: MemoryContext | null = null
  if (modules.memory && messagesWithAttachments.length > 0) {
    memoryContext = await loadMemoryContext(messagesWithAttachments, userId, memoryBaseDir, {
      entrypointMaxLines: behavior.memory.entrypointMaxLines,
      entrypointMaxBytes: behavior.memory.entrypointMaxBytes,
    })
  }

  // 加载项目上下文（THING.md）
  const projectContext = await loadProjectContext(projectRoot, {
    contextFileNames: layout.contextFileNames,
    configDirName: layout.configDirName,
  })

  const instructions = await buildAgentInstructions(skillResolution, memoryContext, {
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
  const budgetCheck = await checkInitialBudget(
    messagesWithAttachments,
    instructions,
    tools,
    modelName,
    dataStore,
    conversationId,
    {
      enabled: sessionOptions.compactionEnabled,
      compactionConfig: sessionOptions.compactionConfig
      ? toRuntimeCompactionConfig(sessionOptions.compactionConfig)
      : undefined,
      compactionThreshold: sessionOptions.compactThreshold,
    },
  )

  // 记录预算检查结果
  console.log(formatEstimationResult(budgetCheck.estimation))

  if (budgetCheck.actions.length > 0) {
    console.log(`[Agent Create] Budget adjustments: ${budgetCheck.actions.join(', ')}`)
  }

  // 如果仍未通过（极端情况），记录警告但继续执行
  if (!budgetCheck.passed) {
    console.warn(
      `[Agent Create] ⚠️ Budget check failed after all strategies. ` +
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

      // 2. 等待后台压缩完成（可选）
      if (options?.waitForCompaction) {
        await waitForConversationCompaction(conversationId)
      }

      // 3. 断开 MCP 连接
      if (mcpRegistry) {
        await mcpRegistry.disconnectAll().catch((e) =>
          console.warn('[AgentHandle.dispose] MCP disconnect error:', e)
        )
      }

      console.log(`[AgentHandle.dispose] Completed for ${conversationId}`)
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
