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
    tools,
    prepareStep,
    stopWhen,
    toolChoice: 'auto',
  })

  return {
    agent,
    sessionState,
    mcpRegistry,
    tools,
    instructions,
  }
}