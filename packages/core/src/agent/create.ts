// ============================================================
// Agent Create - 统一的 Chat Agent 创建入口
// ============================================================

import { ToolLoopAgent, wrapLanguageModel } from 'ai'
import { createSessionState } from '../session-state'
import { createLanguageModel } from '../model-provider'
import { createAgentPipeline, createDefaultStopConditions } from '../agent-control'
import { telemetryMiddleware, costTrackingMiddleware } from '../middleware'
import { resolveActiveSkills, loadMemoryContext, buildAgentInstructions } from './context'
import { loadAllTools } from './tools'
import { checkInitialBudget } from '../compaction/initial-budget-check'
import { formatEstimationResult } from '../compaction/token-counter'
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
  } = config

  const sessionState = createSessionState(conversationId, {
    maxContextTokens: sessionOptions?.maxContextTokens ?? 128_000,
    compactThreshold: sessionOptions?.compactThreshold ?? 25_000,
    maxBudgetUsd: sessionOptions?.maxBudgetUsd ?? 5.0,
    model: modelConfig.modelName ?? sessionOptions?.model,
  })

  let skillResolution: SkillResolution | null = null
  if (enableSkills && messages && messages.length > 0) {
    skillResolution = await resolveActiveSkills(messages)
    if (skillResolution?.activeModelOverride) {
      sessionState.model = skillResolution.activeModelOverride
    }
    if (skillResolution?.activeSkillNames) {
      for (const name of skillResolution.activeSkillNames) {
        sessionState.activeSkills.add(name)
      }
      // Note: sessionState.loadedSkills 需要完整的 Skill 对象
      // 这里只记录名称，完整 Skill 对象在 pipeline 中按需加载
    }
  }

  let memoryContext: MemoryContext | null = null
  if (enableMemory && messages && messages.length > 0) {
    memoryContext = await loadMemoryContext(messages, userId)
  }

  const instructions = await buildAgentInstructions(skillResolution, memoryContext, conversationMeta)

  const modelInstance = createLanguageModel(modelConfig)

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
  })

  // ============================================================
  // ✅ 新增：初始预算检查
  // 参考 ClaudeCode 在第一次调用前估算完整请求
  // ============================================================
  const modelName = modelConfig.modelName || 'qwen-max'  // 默认模型名
  const budgetCheck = await checkInitialBudget(
    messages || [],
    instructions,
    tools,
    modelName,
    conversationId
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

  // 注意：消息在流式调用时传入，这里返回 adjustedMessages 供调用方使用
  const adjustedMessages = budgetCheck.adjustedMessages

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
    adjustedMessages,
    budgetActions: budgetCheck.actions,
    model: modelInstance,
  }
}