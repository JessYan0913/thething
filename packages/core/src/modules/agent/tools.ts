// ============================================================
// Agent Tools - 统一的工具加载器
// ============================================================

import type { Tool } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'
import { logger } from '../../primitives/logger'
import {
  createBashTool,
  createEditFileTool,
  createWebFetchTool,
  createGlobTool,
  createGrepTool,
  createReadFileTool,
  createWriteFileTool,
  askUserQuestionTool,
  createSkillTool,
  createFindSkillsTool,
  createCronTool,
  createSaveWikiTool,
  createReadWikiPageTool,
  createLintWikiTool,
  createIngestWikiSourceTool,
  createInspectWikiHistoryTool,
  createRestoreWikiRevisionTool,
  createContextPinTool,
} from '../tools'
import { createTodoToolsForConversation } from '../todos'
import { AgentRegistry, registerBuiltinAgents, createAgentTool, createParallelAgentTool } from '.'
import { createMcpRegistry, type McpRegistry, wrapMcpToolWithOutputHandler } from '../../modules/mcp'
import { getAllConnectorTools } from '../../modules/connector'
import type { LoadToolsConfig } from './types'
import { loadSkills } from '../skills/loader'

export interface LoadedToolsResult {
  tools: Record<string, Tool>
  mcpRegistry: McpRegistry | undefined
  /** 标记 registry 是否为 AppContext 共享，用于调用方决定 dispose 行为 */
  isSharedMcpRegistry: boolean
  /** 已注册的 connector 工具名（{connectorId}_{toolName}），用于审批识别 */
  connectorToolNames: string[]
}

export async function loadAllTools(config: LoadToolsConfig): Promise<LoadedToolsResult> {
  const tools: Record<string, Tool> = {}
  let mcpRegistry: McpRegistry | undefined
  let isSharedMcpRegistry = false
  const agentRegistry = new AgentRegistry()

  const protectedWritePaths = config.wikiBaseDir ? [config.wikiBaseDir] : []

  Object.assign(tools, {
    web_fetch: createWebFetchTool(),
    read_file: createReadFileTool({
      cwd: config.sessionState.projectRoot,
      extraSensitivePaths: config.sessionState.extraSensitivePaths,
      permissionRules: config.sessionState.permissionRules,
    }),
    write_file: createWriteFileTool({
      cwd: config.sessionState.projectRoot,
      extraSensitivePaths: config.sessionState.extraSensitivePaths,
      permissionRules: config.sessionState.permissionRules,
      protectedWritePaths,
    }),
    edit_file: createEditFileTool({
      cwd: config.sessionState.projectRoot,
      extraSensitivePaths: config.sessionState.extraSensitivePaths,
      permissionRules: config.sessionState.permissionRules,
      protectedWritePaths,
    }),
    bash: createBashTool({
      cwd: config.sessionState.projectRoot,
      permissionRules: config.sessionState.permissionRules,
      protectedWritePaths,
      writerRef: config.writerRef ?? { current: null },
    }),
    grep: createGrepTool({
      cwd: config.sessionState.projectRoot,
    }),
    glob: createGlobTool({
      cwd: config.sessionState.projectRoot,
    }),
    ask_user_question: askUserQuestionTool,
    context_pin: createContextPinTool({
      ledger: config.sessionState.contextLedger,
    }),
  })

  Object.assign(tools, createTodoToolsForConversation(config.sessionState.todoStore, config.conversationId))

  if (config.cronStore) {
    tools.cron = createCronTool({
      cronStore: config.cronStore,
      tasksDir: config.tasksDir,
    })
  }

  // 注册 Wiki 工具（需要 wikiBaseDir）
  if (config.wikiBaseDir) {
    tools.save_wiki = createSaveWikiTool({
      wikiBaseDir: config.wikiBaseDir,
    })
    tools.read_wiki_page = createReadWikiPageTool({
      wikiBaseDir: config.wikiBaseDir,
    })
    tools.lint_wiki = createLintWikiTool({
      wikiBaseDir: config.wikiBaseDir,
      model: config.model,
    })
    tools.ingest_wiki_source = createIngestWikiSourceTool({
      wikiBaseDir: config.wikiBaseDir,
    })
    tools.inspect_wiki_history = createInspectWikiHistoryTool({
      wikiBaseDir: config.wikiBaseDir,
    })
    tools.restore_wiki_revision = createRestoreWikiRevisionTool({
      wikiBaseDir: config.wikiBaseDir,
    })
  }

  // 1. 注册内置 Agent
  registerBuiltinAgents(agentRegistry)

  // 2. 注册 AppContext 快照中的用户/项目自定义 Agent
  const customAgents = config.agents ?? []
  if (customAgents.length > 0) {
    logger.debug('AgentLoader', `Registered ${customAgents.length} preloaded agents: ${customAgents.map(a => a.agentType).join(', ')}`)
  }
  for (const agent of customAgents) {
    agentRegistry.register(agent)
  }

  // Log total registered agents
  logger.debug('AgentRegistry', `Total registered: ${agentRegistry.getAll().map(a => `${a.agentType}(${a.source})`).join(', ')}`)

  // 3. 创建 agent 工具（共享配置）
  const agentToolConfig = {
    parentTools: tools,
    parentModel: config.model,
    parentSystemPrompt: '',
    parentMessages: config.parentMessages ?? [],
    writerRef: config.writerRef ?? { current: null },
    cwd: config.sessionState.projectRoot,
    agentsLayoutDirs: config.sessionState.layout.resources.agents,
    provider: config.provider,
    modelAliases: config.modelAliases,
    agents: customAgents,
    agentRegistry,
    configDir: config.sessionState.layout.configDir,
    dynamicReload: config.dynamicReload ?? false,
    compactionConfig: config.compactionConfig,
    // 子 Agent 总 token 预算上限（经 stopWhen 用每步真实 usage 累计判断）
    maxTotalTokens: 200_000,
  }

  // 3. 创建统一的 agent 工具
  tools.agent = createAgentTool(agentToolConfig)

  // Skill fork 与普通 agent 工具共享同一执行配置；此时 tools 已包含完整父工具池。
  const reloadSkills = async () => loadSkills({
    cwd: config.sessionState.projectRoot,
    configDir: config.sessionState.layout.configDir,
  })
  tools.skill = createSkillTool({
    skills: config.skills ?? [],
    reloadSkills,
    sessionState: config.sessionState,
    modelAliases: config.modelAliases,
    availableModels: config.availableModels,
    agentConfig: agentToolConfig,
    disabledSkills: config.disabledSkills,
    usageDataDir: config.sessionState.layout.dataDir,
  })

  // 技能检索通路：系统提示词只常驻部分技能描述，其余经本工具按需检索
  tools.find_skills = createFindSkillsTool({
    skills: config.skills ?? [],
    reloadSkills,
    disabledSkills: config.disabledSkills,
  })

  // 4. 创建并行 agent 工具（多子 Agent 同时执行）
  tools.parallel_agent = createParallelAgentTool(agentToolConfig)

  if (config.enableMcp) {
    try {
      const mcpConfigs = config.mcps ?? []
      if (mcpConfigs.length > 0) {
        const sharedRegistry = config.mcpRegistry
        const activeRegistry = sharedRegistry ?? createMcpRegistry(mcpConfigs)
        await activeRegistry.connectAll()

        isSharedMcpRegistry = !!sharedRegistry

        // Claude Code 风格：直接注册每个 MCP 工具为独立 tool
        // 命名 mcp__serverName__toolName → 命名空间隔离，防冲突，可路由
        for (const [serverName, connection] of activeRegistry.connections) {
          if (!connection.tools) continue
          for (const [toolName, toolDef] of Object.entries(connection.tools)) {
            const qualifiedName = `mcp__${serverName}__${toolName}`
            if (!(qualifiedName in tools)) {
              const wrapOptions = {
                sessionId: config.conversationId,
                dataDir: config.sessionState.layout.dataDir,
                contentReplacementState: config.sessionState.contentReplacementState,
                toolOutputConfig: config.sessionState.toolOutputConfig,
              }

              // 统一使用标准包装器（不再区分 MCP App 工具）
              tools[qualifiedName] = wrapMcpToolWithOutputHandler(
                toolDef as Tool,
                qualifiedName,
                wrapOptions,
              )
            }
          }
        }

        // 始终返回 activeRegistry，调用方通过 isSharedMcpRegistry 决定 dispose 行为
        mcpRegistry = activeRegistry

        const mcpSnapshot = activeRegistry.snapshot()
        const connected = mcpSnapshot.servers.filter(s => s.connected)
        const failed = mcpSnapshot.servers.filter(s => !s.connected && s.enabled)
        logger.debug('MCP', `${mcpSnapshot.totalTools} MCP tools from ${connected.length} server(s)${sharedRegistry ? ' (reused)' : ''}`)
        if (failed.length > 0) {
          logger.warn('MCP', `Failed servers: ${failed.map(s => `${s.name}(${s.error})`).join(', ')}`)
        }
      } else {
        logger.debug('MCP', 'No MCP configs found')
      }
    } catch (error) {
      logger.error('MCP', 'Connection error:', error)
    }
  }

  const connectorToolNames: string[] = []
  if (config.enableConnector) {
    try {
      const registry = config.connectorRegistry
      if (!registry) {
        logger.warn('Connector', 'connectorRegistry not provided; skipping connector tools')
        return { tools, mcpRegistry, isSharedMcpRegistry, connectorToolNames }
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
          connectorToolNames.push(toolName)
        }
      }
    } catch (error) {
      logger.error('Connector', 'Failed to load tools:', error)
    }
  }

  return { tools, mcpRegistry, isSharedMcpRegistry, connectorToolNames }
}
