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
import { loadAll } from '../../api/loaders'
import { loadProjectContext } from '../../extensions/system-prompt/sections/project-context'
import {
  injectMessageAttachments,
  clearMessageAttachmentState,
} from '../../extensions/attachments'
import type { CreateAgentConfig, CreateAgentResult, SkillResolution, MemoryContext } from './types'

export async function createChatAgent(config: CreateAgentConfig): Promise<CreateAgentResult> {
  const {
    conversationId,
    messages,
    userId = 'default',
    modelConfig,
    sessionOptions,
    conversationMeta,
    enableMcp = true,
    enableSkills = true,
    enableMemory = true,
    enableConnector = true,
    writerRef,
    preloadedData,
  } = config

  const dataStore = preloadedData.dataStore

  // 判断是否是首次对话
  const isTurnZero = conversationMeta?.isNewConversation ?? false

  // 加载配置数据：优先使用 preloadedData（来自 AppContext），避免重复 loadAll
  const cwd = sessionOptions?.projectDir ?? preloadedData?.cwd
  const loadedData = preloadedData ?? await loadAll({ cwd })

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

  if (enableSkills && messages && messages.length > 0) {
    const attachmentResult = await injectMessageAttachments(messages, {
      sessionKey: conversationId,
      skills: loadedData.skills,
      contextWindowTokens: sessionOptions?.maxContextTokens ?? 128_000,
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
    maxContextTokens: sessionOptions?.maxContextTokens ?? 128_000,
    compactThreshold: sessionOptions?.compactThreshold ?? 25_000,
    maxBudgetUsd: sessionOptions?.maxBudgetUsd ?? 5.0,
    model: modelConfig.modelName ?? sessionOptions?.model,
    projectDir: cwd,
    dataStore,
  })

  let skillResolution: SkillResolution | null = null
  if (enableSkills && messagesWithAttachments.length > 0) {
    skillResolution = await resolveActiveSkills(messagesWithAttachments, loadedData.skills)
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
  if (enableMemory && messagesWithAttachments.length > 0) {
    memoryContext = await loadMemoryContext(messagesWithAttachments, userId, cwd)
  }

  // 加载项目上下文（THING.md）
  const projectContext = await loadProjectContext(cwd)

  const instructions = await buildAgentInstructions(skillResolution, memoryContext, {
    cwd,  // 传递工作目录给系统提示（让 Agent 知道正确的执行路径）
    skills: loadedData.skills,
    permissions: loadedData.permissions,
    memoryEntries: loadedData.memory,
    projectContext,
    conversationMeta,
  })

  const modelInstance = createLanguageModel(modelConfig)
  const provider = createModelProvider(modelConfig)

  const wrappedModel = wrapLanguageModel({
    model: modelInstance,
    middleware: [
      telemetryMiddleware(),
      costTrackingMiddleware(sessionState.costTracker),
    ],
  })

  const { tools, mcpRegistry } = await loadAllTools({
    conversationId,
    sessionState,
    enableMcp,
    enableConnector,
    writerRef,
    model: wrappedModel,
    provider,
  })

  // ============================================================
  // ✅ 新增：初始预算检查
  // 参考 ClaudeCode 在第一次调用前估算完整请求
  // ============================================================
  const modelName = modelConfig.modelName || 'qwen-max'  // 默认模型名
  const budgetCheck = await checkInitialBudget(
    messagesWithAttachments,
    instructions,
    tools,
    modelName,
    dataStore,
    conversationId,
  )

  // 记录预算检查结果
  console.log(formatEstimationResult(budgetCheck.estimation))

  if (budgetCheck.actions.length > 0) {
    console.log(`[Agent Create] Budget adjustments: ${budgetCheck.actions.join(', ')}`)
  }

  // 如果仍未通过（极端情况），记录警告但继续执行
  // 让 API 返回实际错误以便触发恢复链
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

  const prepareStep = createAgentPipeline<ChatToolsType>({
    sessionState,
    maxSteps: 50,
    maxBudgetUsd: 5.0,
  })

  const stopWhen = createDefaultStopConditions<ChatToolsType>(sessionState.costTracker, {
    maxSteps: 50,
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

  return {
    agent,
    sessionState,
    mcpRegistry,
    tools: finalTools,
    instructions,
    adjustedMessages: finalMessages,
    budgetActions: budgetCheck.actions,
    model: modelInstance,
    // 新增：附件注入信息
    attachmentInfo,
  }
}