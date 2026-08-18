// ============================================================
// App Create - Agent 创建入口
// ============================================================
// 合并原 composition/app/create.ts（配置解析）+ modules/agent/create.ts（组装编排），
// 让组装逻辑正确归属于 composition 层。

import type { ToolApprovalStatus, UIMessage } from 'ai';
import { ToolLoopAgent, wrapLanguageModel, generateText } from 'ai'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { SubAgentStreamWriter } from '../../modules/agent'
import type { CompactionConfig } from '../../modules/compaction/types'
import type { CreateAgentOptions, CreateAgentResult } from './types'
import { resolveAgentConfig } from './resolve-agent-config'
import { createSessionState } from '../../modules/session'
import { createLanguageModel, createModelProvider } from '../../services/model'
import { getModelOutputTokens } from '../../services/model/capabilities'
import { createAgentPipeline, createDefaultStopConditions } from '../../modules/agent-control'
import { catchAllApproval } from '../../modules/agent-control/tool-approval'
import type { ApprovalRuntimeContext } from '../../modules/agent-control/tool-approval'
import { setReviewerDenial, extractInputKey } from '../../modules/agent-control/reviewer-feedback'
import { telemetryMiddleware, costTrackingMiddleware } from '../../modules/middleware'
import { loadAllTools } from '../../modules/agent/tools'
import { filterToolNames } from '../../modules/agent/tool-resolver'
import { repairAskUserQuestionRawInput } from '../../modules/tools'
import { checkInitialBudget } from '../../modules/compaction/budget-check'
import { formatEstimationResult } from '../../modules/compaction/token-counter'
import { compactBeforeStep } from '../../modules/compaction'
import { createCompactContextTool } from '../../modules/compaction/compact-context'
import { DEFAULT_COMPACTION_CONFIG } from '../../modules/compaction/types'
import type { AgentDefinition } from '../../modules/agent/types'
import { resolveModelAlias, isInheritAlias } from '../../services/model/alias'
import { logger } from '../../primitives/logger'
import { getPrimaryWikiDir } from '../../modules/wiki'
import { getPrimaryMemoryDir } from '../../modules/memory'
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
  // 技能信息改为由 System Prompt 的 "Available Skills" section 展示，
  // Agent 看到匹配的 skill 后通过 skill tool 按需加载完整指令。
  // ============================================================
  const messagesWithAttachments = messages

  // 记忆 relevance 打分 query。
  // C5（架构审查）：不把查询钉死在"最后一条用户消息"——那会让记忆召回只看
  // 最近一句、遗漏更早承载关键背景的消息。这里聚合本次对话全部用户消息文本
  // 作为检索 hint，仅作有界护栏（MAX_MEMORY_QUERY_CHARS 上限；截断处省略标记）。
  // 记忆本身仍全量进入召回排序，query 只影响 relevance 分。
  const MAX_MEMORY_QUERY_CHARS = 800
  const memoryQuery = (() => {
    const userTexts: string[] = []
    for (let i = messagesWithAttachments.length - 1; i >= 0; i--) {
      const m = messagesWithAttachments[i]
      if (m.role !== 'user') continue
      const texts = (m.parts ?? [])
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map(p => p.text)
        .filter(Boolean)
      if (texts.length > 0) userTexts.push(texts.join('\n'))
      if (userTexts.length >= 20) break
    }
    userTexts.reverse()
    const joined = userTexts.join('\n')
    return joined.length > MAX_MEMORY_QUERY_CHARS
      ? `${joined.slice(0, MAX_MEMORY_QUERY_CHARS)}…`
      : joined
  })()

  // ============================================================
  // Session 状态
  // ============================================================
  const sessionState = await createSessionState(conversationId, {
    ...sessionOptions,
    model: modelConfig.modelName ?? sessionOptions.model,
    dataStore,
  })

  // ============================================================
  // 并行加载 wiki + project context + 技能偏好/使用统计
  // ============================================================
  const { loadProjectContext } = await import('../../modules/system-prompt/sections/project-context')
  const { loadSkillPreferences } = await import('../../modules/skills/preferences')
  const { loadSkillUsage } = await import('../../modules/skills/usage')

  const [wikiContext, projectContext, skillPreferences, skillUsage] = await Promise.all([
    (async () => {
      if (messagesWithAttachments.length === 0) return null
      return loadWikiContextForAgent(messagesWithAttachments, wikiBaseDir)
    })(),
    loadProjectContext(projectRoot, {
      contextFileNames: layout.contextFileNames,
      configDir: layout.configDir,
    }),
    loadSkillPreferences(layout.configDir),
    loadSkillUsage(layout.dataDir),
  ])

  // ============================================================
  // 技能常驻集（docs/skill-resident-set-design.md）
  // 每会话只算一次（conversationId 键的进程级缓存），保证 session
  // 缓存策略的 skill-matching section 会话内字节稳定。
  // ============================================================
  const { getSessionSkillResidentSet, selectResidentSet, formatResidentSections } =
    await import('../../modules/skills/resident-set')

  const residentSet = getSessionSkillResidentSet(conversationId, () =>
    selectResidentSet(context.skills, {
      preferences: skillPreferences,
      usage: skillUsage,
    }),
  )
  const skillListing = formatResidentSections(residentSet, skillPreferences)

  // ============================================================
  // Instructions
  // ============================================================
  const { buildAgentInstructions } = await import('../../modules/agent/context/instructions')

  // wiki 上下文：注入 wiki guidelines prompt，
  // recalledContent 为空只表示没有已召回的页面，不影响 guidelines 注入
  const wikiPromptContext = { recalledContent: wikiContext?.recalledContent || '' }

  // 构建 MCP 工具列表文本，让 Agent 在系统提示中直接看到可用工具
  // （Agent 定义 mcp: false 时不注入——工具已被过滤，提示词不应宣称可用）
  const mcpServerTools = selectedAgentDef?.mcp === false
    ? ''
    : formatMcpServerTools([...context.mcpRegistry.servers], context.mcpRegistry)

  const instructions = await buildAgentInstructions(wikiPromptContext, {
    cwd: projectRoot,
    wikiBaseDir,
    skills: [...context.skills],
    skillListing,
    permissions: modules.permissions ? [...context.permissions] : [],
    projectContext,
    conversationMeta: options.conversationMeta ? {
      messageCount: messages.length,
      isNewConversation: options.conversationMeta.isNewConversation,
      conversationStartTime: options.conversationMeta.conversationStartTime ?? Date.now(),
      sessionSource: options.conversationMeta.sessionSource,
      sessionSourceId: options.conversationMeta.sessionSourceId,
    } : undefined,
    mcpServerTools,
    todoStore: sessionState.todoStore,
    conversationId,
    // Agent 定义的 instructions 上升为提示词开头的身份 section，
    // customInstructions 只含调用方传入的动态内容（如 todoNote）
    customInstructions: options.customInstructions,
    agentIdentity: selectedAgentDef?.instructions,
    // 当选择自定义 Agent 时，跳过默认 identity 和 capabilities（"通用智能助手"身份声明）
    excludeSections: selectedAgentDef ? ['identity', 'capabilities'] : undefined,
    memoryBaseDir,
    memoryQuery,
    memoryTopK: behavior.memory?.memoryTopK,
  })

  // ============================================================
  // Model + compact 注入
  // ============================================================
  // Agent 定义了非 inherit 语义的模型('fast' 或具体模型名)时覆盖 modelName;
  // 'inherit'/'smart'/'default' 均跟随会话主模型(见 alias.ts 语义收敛)
  if (selectedAgentDef?.model && (typeof selectedAgentDef.model !== 'string' || !isInheritAlias(selectedAgentDef.model))) {
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
  // provider 包装 costTrackingMiddleware:子 Agent 用自定义模型(fast/smart)时,
  // provider(modelName) 创建的 model 也进成本统计。
  const rawProvider = createModelProvider(modelConfig)
  const createTrackedModel = (modelName: string, includeTelemetry: boolean): LanguageModel => wrapLanguageModel({
    model: rawProvider(modelName),
    middleware: [
      ...(includeTelemetry
        ? [telemetryMiddleware({ debugEnabled: Boolean(context.runtime.env.DEBUG) })]
        : []),
      costTrackingMiddleware(sessionState.costTracker),
    ] as LanguageModelMiddleware[],
  }) as unknown as LanguageModel
  const provider = (modelName: string) => createTrackedModel(modelName, false)
  const resolveStepModel = (modelName: string) => createTrackedModel(modelName, true)

  // compactModel 包 costTrackingMiddleware:紧急压缩 + selfHeal checkpoint 的
  // token 用量也进成本统计(不包 telemetry,避免污染 agent 遥测指标)。
  sessionState.compactModel = wrapLanguageModel({
    model: modelInstance,
    middleware: [costTrackingMiddleware(sessionState.costTracker)] as LanguageModelMiddleware[],
  }) as unknown as LanguageModelV3

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
  const { tools, mcpRegistry, isSharedMcpRegistry, connectorToolNames } = await loadAllTools({
    conversationId,
    sessionState,
    enableMcp: modules.mcps,
    enableConnector: modules.connectors,
    connectorRegistry: context.runtime.connectorRegistry,
    writerRef: options.writerRef as { current: SubAgentStreamWriter | null } | undefined,
    model: wrappedModel,
    provider,
    skills: [...context.skills],
    disabledSkills: skillPreferences.disabled,
    agents: [...context.agents],
    mcps: [...context.mcpRegistry.servers],
    mcpRegistry: context.mcpRegistry,
    debugEnabled: Boolean(context.runtime.env.DEBUG),
    modelAliases: behavior.modelAliases,
    // 模型白名单来自配置的模型列表(多供应商条目);空数组 = 不限制
    availableModels: (modelConfig.models ?? []).map(model => model.id),
    dynamicReload: resolved.dynamicReload,
    // 子 Agent 上下文注入：createAgent 每请求重建，此快照即当前完整历史
    parentMessages: messagesWithAttachments,
    // 子 Agent Layer 2 压缩配置（尊重 modules.compaction 开关）
    compactionConfig: modules.compaction ? compactionCfg : undefined,
    // 子 Agent 输出预算上限（模型条目 outputTokens，缺省回落默认）
    maxOutputTokens: getModelOutputTokens(modelConfig.modelName, modelConfig.models),
    cronStore: context.runtime.cronStore ?? undefined,
    tasksDir: context.runtime.tasksDir,
    userId,
    wikiBaseDir,
    memoryBaseDir,
  })

  // 如果 Agent 定义了工具白名单/能力开关，过滤工具集
  // （与子 Agent 共用 filterToolNames：白名单只约束系统工具，
  //   MCP/connector 工具由 mcp/connectors 开关控制）
  let filteredTools = tools
  if (selectedAgentDef) {
    const kept = new Set(filterToolNames(Object.keys(tools), {
      tools: selectedAgentDef.tools,
      connectors: selectedAgentDef.connectors,
      skills: selectedAgentDef.skills,
      mcp: selectedAgentDef.mcp,
      connectorToolNames: new Set(connectorToolNames),
      denySubAgentTools: false, // 主 Agent 保留 agent/parallel_agent
    }))
    if (kept.size !== Object.keys(tools).length) {
      filteredTools = Object.fromEntries(
        Object.entries(tools).filter(([name]) => kept.has(name)),
      )
      logger.debug('AgentCreate', `Tools filtered by agent definition: ${Object.keys(filteredTools).join(', ')}`)
    }
  }

  // ============================================================
  // 初始预算检查
  // ============================================================
  const modelName = modelConfig.modelName || behavior.modelAliases.default?.model
  const budgetCheck = await checkInitialBudget(
    messagesWithAttachments as unknown as import('ai').ModelMessage[],
    instructions,
    filteredTools,
    modelName,
    compactionCfg,
    {
      dataStore,
      conversationId,
      model: modelInstance,
      contextLimit: sessionOptions.maxContextTokens,
      outputTokens: getModelOutputTokens(modelConfig.modelName, modelConfig.models),
    },
  )

  logger.debug('AgentCreate', formatEstimationResult(budgetCheck.estimation))

  if (budgetCheck.actions.length > 0) {
    logger.debug('AgentCreate', `Budget adjustments: ${budgetCheck.actions.join(', ')}`)
  }

  if (!budgetCheck.passed) {
    const e = budgetCheck.estimation
    const parts = [
      `指令 ${e.instructionsTokens}`,
      `消息 ${e.messagesTokens}`,
      `工具 ${e.toolsTokens}`,
      `输出预留 ${e.outputReserve}`,
    ]
    const buf = e.tokenizerBuffer > 0 ? ` + 校准buffer ${e.tokenizerBuffer}` : ''
    const msg = `上下文超限(${e.totalTokensWithBuffer} tokens > ${e.modelLimit} 窗口上限,含${parts.join(' + ')}${buf}),已尝试 ${budgetCheck.actions.length > 0 ? budgetCheck.actions.join('; ') : '所有策略均失败'}。请减少本轮消息量或开始新会话。`
    logger.warn('AgentCreate', msg)
    throw new Error(`CONTEXT_BUDGET_EXCEEDED: ${msg}`)
  }

  const finalTools = budgetCheck.adjustedTools ?? filteredTools
  const finalMessages = (budgetCheck.adjustedMessages ?? messagesWithAttachments) as UIMessage[]

  // ── 模型主动压缩（P2）：compact_context 工具 → 登记槽 → prepareStep 应用 ──
  const compactionRequestRef: { current: import('../../modules/compaction/compact-context').CompactContextRequest | null } = { current: null }
  finalTools.compact_context = createCompactContextTool({
    requestRef: compactionRequestRef,
    getUtilizationPercent: () => sessionState.lastEstimation?.utilizationPercent ?? null,
  })

  // ── 闸门：最终不变量验证 ──
  const { assertContextInvariant } = await import('../../modules/compaction/gate')
  const gateResult = await assertContextInvariant(
    finalMessages as unknown as import('ai').ModelMessage[],
    instructions,
    finalTools,
    modelName,
    sessionOptions.maxContextTokens,
  )
  if (!gateResult.passed) {
    throw new Error(`CONTEXT_BUDGET_EXCEEDED: ${gateResult.decision}`)
  }

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
      const afterResult = await compactBeforeStep(msgs, compactionCfg, {
        model: sessionState.compactModel,
        fallbackModels: sessionState.fallbackModels,
        modelName: sessionState.model,
        conversationId,
        dataStore: sessionState.dataStore,
        contextLimit: sessionOptions.maxContextTokens,
        instructionsTokens: overheadInstructions,
        toolsTokens: overheadTools,
        // Layer 2 压缩落盘可恢复:与 budget 模块共用存储目录(见主文档 B)
        storage: { sessionId: conversationId, dataDir: sessionState.layout.dataDir },
        // 上下文水位改为通过 updateContextBudget → 会话数据库传递，不再走 stream
        tools: filteredTools,
        instructions,
        // 模型主动压缩登记槽（P2）
        compactionRequestRef,
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
    const result = manageToolOutputLifecycle(msgs, compactionCfg.lifecycle, {
      sessionId: conversationId,
      dataDir: sessionState.layout.dataDir,
    })
    return {
      messages: result.messages,
      executed: result.tokensFreed > 0,
      tokensFreed: result.tokensFreed,
      actions: result.tokensFreed > 0 ? [`Layer 2: freed ${result.tokensFreed} tokens`] : [],
    }
  }

  // 上下文水位：pipeline 每步估算后写入会话数据库，前端直接读取
  sessionState.updateContextBudget = (estimation) => {
    dataStore.conversationStore.updateContextBudget(conversationId, {
      usagePercentage: estimation.utilizationPercent,
      totalTokens: estimation.totalTokens,
      modelLimit: estimation.modelLimit,
      messagesTokens: estimation.messagesTokens,
      instructionsTokens: estimation.instructionsTokens,
      toolsTokens: estimation.toolsTokens,
      outputReserve: estimation.outputReserve,
      cachedReadTokens: estimation.cachedReadTokens,
      stepInputTokens: estimation.stepInputTokens,
      lastCompactionFreedTokens: estimation.lastCompactionFreedTokens,
      compactionActive: estimation.compactionActive,
      sessionInputTokens: estimation.sessionInputTokens,
      sessionOutputTokens: estimation.sessionOutputTokens,
      sessionCostUsd: estimation.sessionCostUsd,
    });
  };

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
    // 动态 outputReserve：预算与每模型 maxOutputTokens 一致（ModelEntry.outputTokens，缺省 8000）
    outputTokens: getModelOutputTokens(modelConfig.modelName, modelConfig.models),
    triggerPercent: compactionCfg.contextWindow.triggerPercent,
    resolveModel: resolveStepModel,
    compactionCallbackRef: options.compactionCallbackRef,
  })

  const stopWhen = createDefaultStopConditions<ChatToolsType>(sessionState.costTracker, {
    maxSteps,
    denialTracker: sessionState.denialTracker,
    sessionState,
  })

  // ── v7 智能审批：runtimeContext + toolApproval ─────────
  const reviewer = options.approvalMode === 'auto-review'
    ? createApprovalReviewer(wrappedModel, instructions)
    : undefined;

  const approvalRuntimeContext: ApprovalRuntimeContext = {
    turnCount: sessionState.turnCount,
    projectRoot: sessionState.projectRoot,
    permissionRules: sessionState.permissionRules,
    costTracker: sessionState.costTracker,
    denialTracker: sessionState.denialTracker,
    approvalMode: options.approvalMode ?? 'smart',
    reviewer,
    connectorToolNames: new Set(connectorToolNames),
  }
  // ── Checkpoint 回调：跟踪工具调用，每步结束写 checkpoint ──
  const agentRunStore = options.agentRunStore;
  let checkpointStepCount = 0;
  const checkpointToolsUsed: string[] = [];

  // 创建 agent run checkpoint（如果 store 和 conversationId 都存在）
  if (agentRunStore && conversationId) {
    agentRunStore.createRun(conversationId);
  }

  const agent = new ToolLoopAgent<never, ChatToolsType, ApprovalRuntimeContext>({
    model: wrappedModel,
    instructions,
    tools: finalTools,
    // 输出预算上限：模型条目声明了 outputTokens 时跟随，否则回落默认。
    // 缺省时不设则 provider 用默认上限，thinking 模型推理 token 可能挤爆输出 → 静默截断。
    maxOutputTokens: getModelOutputTokens(modelConfig.modelName, modelConfig.models),
    runtimeContext: approvalRuntimeContext,
    toolApproval: catchAllApproval as unknown as import('ai').ToolApprovalConfiguration<ChatToolsType, ApprovalRuntimeContext>,
    prepareStep: prepareStep as import('ai').PrepareStepFunction<ChatToolsType, ApprovalRuntimeContext>,
    stopWhen,
    toolChoice: 'auto',
    // 修复 ask_user_question 输入：模型偶尔会把 questions 数组序列化为 JSON 字符串
    // （且常被截断），Zod 校验失败抛出泛化的 "An error occurred"，Agent 难以自我修复。
    // repairToolCall 仅在 NoSuchToolError/InvalidToolInputError 时被 SDK 调用，
    // 这里尝试把字符串 parse/补全回数组。（refineToolInput 只在校验成功后执行，
    // 对该失败路径无效。）
    experimental_repairToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== 'ask_user_question') return null;
      const repaired = repairAskUserQuestionRawInput(toolCall.input);
      if (repaired == null) return null;
      return { ...toolCall, input: repaired };
    },
    onToolExecutionEnd: ({ toolCall }) => {
      checkpointStepCount++;
      checkpointToolsUsed.push(toolCall.toolName);
      if (agentRunStore && conversationId) {
        agentRunStore.updateRun(conversationId, {
          stepCount: checkpointStepCount,
          toolsUsed: [...new Set(checkpointToolsUsed)],
        });
      }

      // 当 todo 工具执行后，推送任务清单快照到流，前端无需轮询
      if (toolCall.toolName.startsWith('todo_') && conversationId) {
        try {
          const todos = dataStore.todoStore.getTodosByConversation(conversationId);
          const writer = (options.writerRef as { current: SubAgentStreamWriter | null } | undefined)?.current;
          if (writer) {
            writer.write({
              type: 'data-todo-update',
              id: `todo-${toolCall.toolCallId}`,
              data: { todos },
            });
          }
        } catch {
          // 不影响主流程
        }
      }
    },
  })

  // ============================================================
  // dispose
  // ============================================================
  const dispose = async (_options?: { waitForCompaction?: boolean }): Promise<void> => {
    await sessionState.costTracker.persistToDB()
    // 仅断开非共享的 MCP registry（共享 registry 由 AppContext 管理）
    if (mcpRegistry && !isSharedMcpRegistry) {
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
    // 仅非共享的 per-request registry 需要调用方清理（finalize 时断开）；
    // 共享 registry 为 null，由 AppContext/dispose/syncServers 管理生命周期。
    ownedMcpRegistry: isSharedMcpRegistry ? null : mcpRegistry,
    tools: finalTools,
    instructions,
    adjustedMessages: finalMessages,
    budgetActions: budgetCheck.actions,
    model: modelInstance,
    wikiBaseDir,
    dispose,
  }
}

/**
 * 创建审批审查 Agent（auto-review 模式用）。
 * 当 Smart 逻辑不确定时，调一次 LLM 决定是否放行。
 * 上下文包括：用户原始目标、最近执行记录、Agent 系统指令。
 */
function createApprovalReviewer(model: import('ai').LanguageModel, instructions: string): ApprovalRuntimeContext['reviewer'] {
  return async (toolName: string, input: unknown, messages: unknown[]) => {
    const msgs = messages as Array<Record<string, unknown>>;

    // A: 提取用户上下文 — 原始目标 + 最近意图
    function userText(m: Record<string, unknown>): string {
      const c = m.content;
      if (typeof c === 'string') return c.slice(0, 200);
      if (Array.isArray(c)) {
        const t = c.find((p: Record<string, unknown>) => p.type === 'text');
        return String(t?.text ?? '').slice(0, 200);
      }
      return '';
    }

    function lastUserMsgText(msgs: Array<Record<string, unknown>>): string {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') return userText(msgs[i]);
      }
      return '';
    }

    // A: 提取最近消息摘要（含工具调用 + 助手推理文本）
    function extractRecentActivity(m: Record<string, unknown>): string[] {
      if (!Array.isArray(m.content)) return [];
      const parts: string[] = [];
      for (const p of m.content as Array<Record<string, unknown>>) {
        if (p.type === 'text') {
          const txt = String(p.text ?? '').trim();
          if (txt) parts.push(`agent: ${txt.slice(0, 100)}`);
        }
        if (p.type === 'tool-call') {
          const name = p.toolName ?? '?';
          const args = (p.args ?? p.input) as Record<string, unknown> | undefined;
          switch (name as string) {
            case 'read_file': case 'write_file': case 'edit_file':
              parts.push(`${name}(${args?.filePath ?? '?'})`);
              break;
            case 'bash':
              parts.push(`bash(${String(args?.command ?? '').slice(0, 80)})`);
              break;
            case 'web_fetch':
              parts.push(`fetch(${args?.url ?? '?'})`);
              break;
            default:
              parts.push(`${name}`);
          }
        }
      }
      return parts;
    }

    // C: Review 历史缓存
    const reviewCache = new Map<string, { decision: 'approved' | 'denied'; timestamp: number }>();
    const REVIEW_CACHE_TTL = 120_000;
    function cacheKey(toolName: string, input: unknown): string {
      return `${toolName}::${extractInputKey(input, toolName)}`;
    }
    const cacheKeyStr = cacheKey(toolName, input);
    const cached = reviewCache.get(cacheKeyStr);
    if (cached && Date.now() - cached.timestamp < REVIEW_CACHE_TTL) {
      return cached.decision;
    }

    // 1. 原始目标（第一条用户消息）
    const firstUserMsg = msgs.find(m => m.role === 'user');
    const originalGoal = firstUserMsg ? userText(firstUserMsg) : '(none)';

    // A: 当前意图（最后一条用户消息）
    const currentRequest = lastUserMsgText(msgs);

    // A: 最近执行链（最近 6 条 assistant 消息）
    const recentActivity = msgs.slice(-6)
      .filter(m => m.role === 'assistant')
      .flatMap(m => extractRecentActivity(m))
      .slice(-8)
      .join('\n') || '(none)';

    // 当前要审批的操作摘要
    function summarizeToolInput(input: unknown, toolName: string): string {
      if (typeof input !== 'object' || input === null) return String(input ?? '');
      const obj = input as Record<string, unknown>;
      switch (toolName) {
        case 'read_file':
        case 'write_file':
        case 'edit_file':
          return `filePath: "${obj.filePath ?? '?'}"`;
        case 'bash':
          return `command: "${String(obj.command ?? '').slice(0, 200)}"`;
        case 'web_fetch':
          return `url: "${obj.url ?? '?'}"`;
        default:
          return JSON.stringify(obj).slice(0, 300);
      }
    }
    const toolInput = summarizeToolInput(input, toolName);

    try {
      const result = await generateText({
        model,
        system: `You are a security reviewer for an AI coding assistant.

Your job: determine if the CURRENT tool call should be approved or denied, based on what the user originally asked and what the agent has done so far.

Rules:
- APPROVED if the operation clearly carries out the user's original request (even if it involves network access, file modification, or external services — judge by intent, not by category)
- APPROVED if the operation is within the project workspace and advances the task
- DENIED if the operation is destructive (rm -rf /, sudo, modifying system files)
- DENIED if it clearly deviates from what the user asked for
- For network operations: evaluate whether they serve the user's stated goal (e.g. uploading a file for processing, fetching documentation, calling an API). Do not automatically deny network requests — they are often a legitimate part of a workflow.
- When uncertain, APPROVED if the intent is clear and the operation is not destructive; DENIED only if the intent is unknown or actively suspicious.

Respond with exactly "APPROVED", or "DENIED: <brief reason>" if denied. Include a specific reason so the agent can understand why.`,
        prompt: [
          `[User's original goal] ${originalGoal}`,
          currentRequest && currentRequest !== originalGoal ? `[User's latest request] ${currentRequest}` : '',
          `[Agent instructions] ${instructions.slice(0, 500)}`,
          `[Recent activity]`,
          recentActivity,
          ``,
          `[Review] ${toolName}(${toolInput})`,
          ``,
          `Approve or deny?`,
        ].join('\n'),
      });

      const text = result.text.trim();
      const upper = text.toUpperCase();
      if (upper.startsWith('APPROVED')) {
        reviewCache.set(cacheKeyStr, { decision: 'approved', timestamp: Date.now() });
        // 防止缓存无限增长
        if (reviewCache.size > 100) {
          const firstKey = reviewCache.keys().next().value;
          if (firstKey !== undefined) reviewCache.delete(firstKey);
        }
        return 'approved' as ToolApprovalStatus;
      }
      if (upper.startsWith('DENIED')) {
        // B: 提取拒绝原因供工具执行层使用
        const reason = text.slice(6).trim().replace(/^:\s*/, '') || 'Operation denied by reviewer';
        setReviewerDenial(toolName, extractInputKey(input, toolName), reason);
        reviewCache.set(cacheKeyStr, { decision: 'denied', timestamp: Date.now() });
        if (reviewCache.size > 100) {
          const firstKey = reviewCache.keys().next().value;
          if (firstKey !== undefined) reviewCache.delete(firstKey);
        }
        return 'denied' as ToolApprovalStatus;
      }
      return 'user-approval' as ToolApprovalStatus;
    } catch {
      return 'user-approval' as ToolApprovalStatus;
    }
  };
}

async function estimateTokensDiff(before: import('ai').ModelMessage[], after: import('ai').ModelMessage[]): Promise<number> {
  try {
    const { estimateMessagesTokens } = await import('../../modules/compaction/token-counter')
    const beforeTokens = await estimateMessagesTokens(before)
    const afterTokens = await estimateMessagesTokens(after)
    return Math.max(0, beforeTokens - afterTokens)
  } catch {
    return 0
  }
}
