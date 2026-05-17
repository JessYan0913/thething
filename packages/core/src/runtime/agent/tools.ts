// ============================================================
// Agent Tools - 统一的工具加载器
// ============================================================

import type { Tool } from 'ai'
import { wrapLanguageModel } from 'ai'
import {
  createBashTool,
  createEditFileTool,
  createExaSearchTool,
  createGlobTool,
  createGrepTool,
  createReadFileTool,
  createWriteFileTool,
  askUserQuestionTool,
  createSkillTool,
} from '../tools'
import { createTaskToolsForConversation } from '../tasks'
import { AgentRegistry, registerBuiltinAgents, createAgentTool } from '../../extensions/subagents'
import { createMcpRegistry, type McpRegistry, wrapMcpToolsWithOutputHandler } from '../../extensions/mcp'
import { getAllConnectorTools } from '../../extensions/connector'
import { telemetryMiddleware, costTrackingMiddleware } from '../middleware'
import type { LoadToolsConfig } from './types'

export interface LoadedToolsResult {
  tools: Record<string, Tool>
  mcpRegistry?: McpRegistry
}

export async function loadAllTools(config: LoadToolsConfig): Promise<LoadedToolsResult> {
  const tools: Record<string, Tool> = {}
  let mcpRegistry: McpRegistry | undefined
  const agentRegistry = new AgentRegistry()

  const wrappedModel = wrapLanguageModel({
    model: config.model,
    middleware: [
      telemetryMiddleware({ debugEnabled: config.debugEnabled }),
      costTrackingMiddleware(config.sessionState.costTracker),
    ],
  })

  Object.assign(tools, {
    web_search: createExaSearchTool({ apiKey: config.webSearchApiKey }),
    read_file: createReadFileTool({
      cwd: config.sessionState.projectRoot,
      extraSensitivePaths: config.sessionState.extraSensitivePaths,
      permissionRules: config.sessionState.permissionRules,
    }),
    write_file: createWriteFileTool({
      cwd: config.sessionState.projectRoot,
      extraSensitivePaths: config.sessionState.extraSensitivePaths,
      permissionRules: config.sessionState.permissionRules,
    }),
    edit_file: createEditFileTool({
      cwd: config.sessionState.projectRoot,
      extraSensitivePaths: config.sessionState.extraSensitivePaths,
      permissionRules: config.sessionState.permissionRules,
    }),
    bash: createBashTool({
      cwd: config.sessionState.projectRoot,
      permissionRules: config.sessionState.permissionRules,
    }),
    grep: createGrepTool({
      cwd: config.sessionState.projectRoot,
    }),
    glob: createGlobTool({
      cwd: config.sessionState.projectRoot,
    }),
    ask_user_question: askUserQuestionTool,
    skill: createSkillTool({
      skills: config.skills ?? [],
    }),
  })

  Object.assign(tools, createTaskToolsForConversation(config.sessionState.taskStore, config.conversationId))

  // 1. 注册内置 Agent
  registerBuiltinAgents(agentRegistry)

  // 2. 注册 AppContext 快照中的用户/项目自定义 Agent
  const customAgents = config.agents ?? []
  if (customAgents.length > 0) {
    console.log(`[AgentLoader] Registered ${customAgents.length} preloaded agents: ${customAgents.map(a => a.agentType).join(', ')}`)
  }
  for (const agent of customAgents) {
    agentRegistry.register(agent)
  }

  // Log total registered agents
  console.log(`[AgentRegistry] Total registered: ${agentRegistry.getAll().map(a => `${a.agentType}(${a.source})`).join(', ')}`)

  // 3. 创建统一的 agent 工具
  tools.agent = createAgentTool({
    parentTools: tools,
    parentModel: wrappedModel,
    parentSystemPrompt: '',
    parentMessages: [],
    writerRef: config.writerRef ?? { current: null },
    cwd: config.sessionState.projectRoot,
    agentsLayoutDirs: config.sessionState.layout.resources.agents,
    provider: config.provider,
    modelAliases: config.modelAliases,
    agents: customAgents,
    agentRegistry,
    configDirName: config.sessionState.layout.configDirName,
    dynamicReload: config.dynamicReload ?? false,
  })

  if (config.enableMcp) {
    try {
      const mcpConfigs = config.mcps ?? []
      if (mcpConfigs.length > 0) {
        mcpRegistry = createMcpRegistry(mcpConfigs)
        await mcpRegistry.connectAll()
        const mcpTools = mcpRegistry.getAllTools()

        // ✅ 改进：使用包装器处理输出
        const wrappedMcpTools = wrapMcpToolsWithOutputHandler(
          mcpTools as Record<string, Tool>,
          {
            sessionId: config.conversationId,
            dataDir: config.sessionState.layout.dataDir,
            contentReplacementState: config.sessionState.contentReplacementState,
            toolOutputConfig: config.sessionState.toolOutputConfig,
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
      const registry = config.connectorRegistry
      if (!registry) {
        console.warn('[Connector] connectorRegistry not provided; skipping connector tools')
        return { tools, mcpRegistry }
      }
      // ✅ 新增：传递 sessionContext 用于输出持久化
      const sessionContext = {
        sessionId: config.conversationId,
        dataDir: config.sessionState.layout.dataDir,
        contentReplacementState: config.sessionState.contentReplacementState,
        toolOutputConfig: config.sessionState.toolOutputConfig,
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
