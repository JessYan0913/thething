// ============================================================
// App Create - Agent 创建入口
// ============================================================
// 合并原 composition/app/create.ts（配置解析）+ modules/agent/create.ts（组装编排），
// 让组装逻辑正确归属于 composition 层。

import type { ToolApprovalStatus, UIMessage } from 'ai';
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
import { setReviewerDenial, extractInputKey } from '../../modules/agent-control/reviewer-feedback'
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
  // 技能信息改为由 System Prompt 的 "Available Skills" section 展示，
  // Agent 看到匹配的 skill 后通过 skill tool 按需加载完整指令。
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
      return loadWikiContextForAgent(messagesWithAttachments, wikiBaseDir)
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

  // wiki 上下文：注入 wiki guidelines prompt，
  // recalledContent 为空只表示没有已召回的页面，不影响 guidelines 注入
  const wikiPromptContext = { recalledContent: wikiContext?.recalledContent || '' }

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
      sessionSource: options.conversationMeta.sessionSource,
      sessionSourceId: options.conversationMeta.sessionSourceId,
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
    agents: [...context.agents],
    mcps: [...context.mcps],
    mcpRegistry: context.mcpRegistry,
    debugEnabled: Boolean(context.runtime.env.DEBUG),
    modelAliases: behavior.modelAliases,
    dynamicReload: resolved.dynamicReload,
    // 子 Agent 上下文注入：createAgent 每请求重建，此快照即当前完整历史
    parentMessages: messagesWithAttachments,
    // 子 Agent Layer 2 压缩配置（尊重 modules.compaction 开关）
    compactionConfig: modules.compaction ? compactionCfg : undefined,
    cronStore: context.runtime.cronStore ?? undefined,
    tasksDir: context.runtime.tasksDir,
    userId,
    wikiBaseDir,
  })

  // 如果 Agent 定义了工具白名单，过滤工具集
  let filteredTools = tools
  if (selectedAgentDef?.tools?.length) {
    const allowedTools = selectedAgentDef.tools

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
    const msg = `上下文超限(${budgetCheck.estimation.totalTokens} tokens > ${budgetCheck.estimation.modelLimit} 窗口上限),已尝试 ${budgetCheck.actions.length > 0 ? budgetCheck.actions.join('; ') : '所有策略均失败'}。请减少本轮消息量或开始新会话。`
    logger.warn('AgentCreate', msg)
    throw new Error(`CONTEXT_BUDGET_EXCEEDED: ${msg}`)
  }

  const finalTools = budgetCheck.adjustedTools ?? filteredTools
  const finalMessages = (budgetCheck.adjustedMessages ?? messagesWithAttachments) as UIMessage[]

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
        // 传递 writer、tools、instructions，用于每步压缩后发送上下文水位
        writer: options.writerRef?.current ? { write: (chunk: unknown) => options.writerRef!.current?.write?.(chunk) } : undefined,
        tools: filteredTools,
        instructions,
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
    goalState: sessionState.goalState,
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
    runtimeContext: approvalRuntimeContext,
    toolApproval: catchAllApproval as unknown as import('ai').ToolApprovalConfiguration<ChatToolsType, ApprovalRuntimeContext>,
    prepareStep: prepareStep as import('ai').PrepareStepFunction<ChatToolsType, ApprovalRuntimeContext>,
    stopWhen,
    toolChoice: 'auto',
    onToolExecutionEnd: ({ toolCall }) => {
      checkpointStepCount++;
      checkpointToolsUsed.push(toolCall.toolName);
      if (agentRunStore && conversationId) {
        agentRunStore.updateRun(conversationId, {
          stepCount: checkpointStepCount,
          toolsUsed: [...new Set(checkpointToolsUsed)],
        });
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
