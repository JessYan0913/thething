// ============================================================
// App Create - Agent 创建入口
// ============================================================
// 合并原 composition/app/create.ts（配置解析）+ modules/agent/create.ts（组装编排），
// 让组装逻辑正确归属于 composition 层。

import type { ToolApprovalStatus } from 'ai';
import { ToolLoopAgent, wrapLanguageModel, generateText } from 'ai'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'
import type { SubAgentStreamWriter } from '../../modules/agent'
import type { CompactionConfig } from '../../modules/compaction/types'
import type { CreateAgentOptions, CreateAgentResult } from './types'
import { resolveAgentConfig } from './resolve-agent-config'
import { createSessionState } from '../../modules/session'
import { createLanguageModel, createModelProvider } from '../../services/model'
import { createAgentPipeline, createDefaultStopConditions } from '../../modules/agent-control'
import { catchAllApproval } from '../../modules/agent-control/tool-approval'
import type { ApprovalRuntimeContext } from '../../modules/agent-control/tool-approval'
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
  }
  const agent = new ToolLoopAgent<never, ChatToolsType, ApprovalRuntimeContext>({
    model: wrappedModel,
    instructions,
    tools: finalTools,
    runtimeContext: approvalRuntimeContext,
    toolApproval: catchAllApproval as unknown as import('ai').ToolApprovalConfiguration<ChatToolsType, ApprovalRuntimeContext>,
    prepareStep: prepareStep as import('ai').PrepareStepFunction<ChatToolsType, ApprovalRuntimeContext>,
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

/**
 * 创建审批审查 Agent（auto-review 模式用）。
 * 当 Smart 逻辑不确定时，调一次 LLM 决定是否放行。
 * 上下文包括：用户原始目标、最近执行记录、Agent 系统指令。
 */
function createApprovalReviewer(model: import('ai').LanguageModel, instructions: string): ApprovalRuntimeContext['reviewer'] {
  return async (toolName: string, input: unknown, messages: unknown[]) => {
    const msgs = messages as Array<Record<string, unknown>>;

    // 提取用户消息的前 120 字作为摘要
    function firstUserText(m: Record<string, unknown>): string {
      const c = m.content;
      if (typeof c === 'string') return c.slice(0, 120);
      if (Array.isArray(c)) {
        const t = c.find((p: Record<string, unknown>) => p.type === 'text');
        return String(t?.text ?? '').slice(0, 120);
      }
      return '';
    }

    // 提取最近工具调用摘要（只传 toolName + 关键参数）
    function extractToolCalls(m: Record<string, unknown>): string[] {
      if (!Array.isArray(m.content)) return [];
      return (m.content as Array<Record<string, unknown>>)
        .filter((p: Record<string, unknown>) => p.type === 'tool-call')
        .map((p: Record<string, unknown>) => {
          const name = p.toolName ?? '?';
          const args = (p.args ?? p.input) as Record<string, unknown> | undefined;
          switch (name as string) {
            case 'read_file': case 'write_file': case 'edit_file':
              return `${name}(${args?.filePath ?? '?'})`;
            case 'bash':
              return `bash(${String(args?.command ?? '').slice(0, 60)})`;
            case 'web_fetch':
              return `fetch(${args?.url ?? '?'})`;
            default:
              return `${name}`;
          }
        });
    }

    // 1. 用户原始目标（一句话摘要）
    const firstUserMsg = msgs.find(m => m.role === 'user');
    const originalGoal = firstUserMsg ? firstUserText(firstUserMsg) : '(none)';

    // 2. 最近工具调用链（最近 3 轮，只含工具名称+关键参数）
    const recentToolCalls = msgs.slice(-6)
      .filter(m => m.role === 'assistant')
      .flatMap(m => extractToolCalls(m))
      .slice(-5)
      .join(' → ') || '(none)';

    // 3. 当前要审批的操作（只传标识性参数，不传大段内容）
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
- APPROVED if the operation operates within the project workspace
- APPROVED if it clearly carries out the user's original request
- DENIED if the operation is dangerous (rm -rf /, sudo, network downloads, modifying sensitive files)
- DENIED if it deviates from what the user asked for
- When in doubt, DENIED — security first

Respond with exactly one word: APPROVED or DENIED`,
        prompt: [
          `User asked: ${originalGoal}`,
          `Agent instructions: ${instructions.slice(0, 200)}`,
          `Recent: ${recentToolCalls}`,
          `→ Need review: ${toolName}(${toolInput})`,
          ``,
          `Approve or deny? One word:`,
        ].join('\n'),
      });

      const text = result.text.trim().toUpperCase();
      if (text.startsWith('APPROVED')) return 'approved' as ToolApprovalStatus;
      if (text.startsWith('DENIED')) return 'denied' as ToolApprovalStatus;
      return 'user-approval' as ToolApprovalStatus;
    } catch {
      return 'user-approval' as ToolApprovalStatus;
    }
  };
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
