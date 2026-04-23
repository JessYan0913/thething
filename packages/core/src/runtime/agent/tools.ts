// ============================================================
// Agent Tools - 统一的工具加载器
// ============================================================

import type { Tool } from 'ai'
import { wrapLanguageModel } from 'ai'
import {
  bashTool,
  editFileTool,
  exaSearchTool,
  globTool,
  grepTool,
  readFileTool,
  writeFileTool,
  askUserQuestionTool,
  skillTool,
} from '../tools'
import { createTaskToolsForConversation, getGlobalTaskStore } from '../tasks'
import { registerBuiltinAgents, scanAgentDirs, createAgentTool, globalAgentRegistry } from '../../extensions/subagents'
import { getMcpServerConfigs, createMcpRegistry, type McpRegistry, wrapMcpToolsWithOutputHandler } from '../../extensions/mcp'
import { getConnectorRegistry, getAllConnectorTools } from '../../extensions/connector'
import { telemetryMiddleware, costTrackingMiddleware } from '../middleware'
import type { LoadToolsConfig } from './types'

export interface LoadedToolsResult {
  tools: Record<string, Tool>
  mcpRegistry?: McpRegistry
}

export async function loadAllTools(config: LoadToolsConfig): Promise<LoadedToolsResult> {
  const tools: Record<string, Tool> = {}
  let mcpRegistry: McpRegistry | undefined

  const wrappedModel = wrapLanguageModel({
    model: config.model,
    middleware: [
      telemetryMiddleware(),
      costTrackingMiddleware(config.sessionState.costTracker),
    ],
  })

  Object.assign(tools, {
    web_search: exaSearchTool,
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
    bash: bashTool,
    grep: grepTool,
    glob: globTool,
    ask_user_question: askUserQuestionTool,
    skill: skillTool,
  })

  Object.assign(tools, createTaskToolsForConversation(getGlobalTaskStore(), config.conversationId))

  // 1. 注册内置 Agent
  registerBuiltinAgents()

  // 2. 加载并注册用户/项目自定义 Agent
  const customAgents = await scanAgentDirs(config.sessionState.projectDir)
  if (customAgents.length > 0) {
    console.log(`[AgentLoader] Loaded ${customAgents.length} custom agents: ${customAgents.map(a => a.agentType).join(', ')}`)
  }
  for (const agent of customAgents) {
    globalAgentRegistry.register(agent)
  }

  // Log total registered agents
  console.log(`[AgentRegistry] Total registered: ${globalAgentRegistry.getAll().map(a => `${a.agentType}(${a.source})`).join(', ')}`)

  // 3. 创建统一的 agent 工具
  tools.agent = createAgentTool({
    parentTools: tools,
    parentModel: wrappedModel,
    parentSystemPrompt: '',
    parentMessages: [],
    writerRef: config.writerRef ?? { current: null },
    cwd: config.sessionState.projectDir,
    provider: config.provider,
  })

  if (config.enableMcp) {
    try {
      const mcpConfigs = await getMcpServerConfigs(config.sessionState.projectDir)
      if (mcpConfigs.length > 0) {
        mcpRegistry = createMcpRegistry(mcpConfigs)
        await mcpRegistry.connectAll()
        const mcpTools = mcpRegistry.getAllTools()

        // ✅ 改进：使用包装器处理输出
        const wrappedMcpTools = wrapMcpToolsWithOutputHandler(
          mcpTools as Record<string, Tool>,
          {
            sessionId: config.conversationId,
            projectDir: config.sessionState.projectDir,
            contentReplacementState: config.sessionState.contentReplacementState,
          }
        )

        for (const [toolName, toolDef] of Object.entries(wrappedMcpTools)) {
          if (!(toolName in tools)) {
            tools[toolName] = toolDef
          }
        }
        const mcpSnapshot = mcpRegistry.snapshot()
        console.log(`[MCP] ${mcpSnapshot.totalTools} MCP tools available: ${Object.keys(mcpTools).join(', ')}`)
      }
    } catch (error) {
      console.error('[MCP] Connection error:', error)
    }
  }

  if (config.enableConnector) {
    try {
      const registry = await getConnectorRegistry(config.sessionState.projectDir)
      // ✅ 新增：传递 sessionContext 用于输出持久化
      const sessionContext = {
        sessionId: config.conversationId,
        projectDir: config.sessionState.projectDir,
        contentReplacementState: config.sessionState.contentReplacementState,
      }
      const connectorTools = await getAllConnectorTools(registry, sessionContext)
      for (const [toolName, toolDef] of Object.entries(connectorTools)) {
        if (!(toolName in tools)) {
          tools[toolName] = toolDef
        }
      }
    } catch (error) {
      console.error('[Connector] Failed to load tools:', error)
    }
  }

  return { tools, mcpRegistry }
}