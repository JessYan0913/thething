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
} from '../tools'
import { createTaskToolsForConversation, getGlobalTaskStore } from '../tasks'
import { createResearchAgent } from '../subagents'
import { getMcpServerConfigs, createMcpRegistry, type McpRegistry } from '../mcp'
import { getConnectorRegistry, getAllConnectorTools } from '../connector'
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
  })

  Object.assign(tools, createTaskToolsForConversation(getGlobalTaskStore(), config.conversationId))

  tools.research = createResearchAgent({
    model: wrappedModel,
    tools: {
      web_search: exaSearchTool,
      read_file: readFileTool,
      grep: grepTool,
      glob: globTool,
    },
    maxSteps: 20,
    maxContextMessages: 10,
    writerRef: config.writerRef,
  })

  if (config.enableMcp) {
    try {
      const mcpConfigs = await getMcpServerConfigs()
      if (mcpConfigs.length > 0) {
        mcpRegistry = createMcpRegistry(mcpConfigs)
        await mcpRegistry.connectAll()
        const mcpTools = mcpRegistry.getAllTools()
        for (const [toolName, toolDef] of Object.entries(mcpTools)) {
          const prefixedName = `mcp_${toolName}`
          if (!(prefixedName in tools)) {
            tools[prefixedName] = toolDef as Tool
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
      const registry = await getConnectorRegistry()
      const connectorTools = await getAllConnectorTools(registry)
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