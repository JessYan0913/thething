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
  createDeleteWikiTool,
  createContextPinTool,
  createSaveMemoryTool,
  createDeleteMemoryTool,
} from '../tools'
import { createTodoToolsForConversation } from '../todos'
import { createSubmitPlanTool } from '../plan'
import { AgentRegistry, registerBuiltinAgents, createAgentTool, createParallelAgentTool } from '.'
import { createMcpRegistry, type McpRegistry, createRegistryBoundMcpTool } from '../../modules/mcp'
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

  Object.assign(tools, createTodoToolsForConversation(config.sessionState.todoStore, config.conversationId, {
    onTodoCompleted: (todoId) => { config.sessionState.pendingArchiveTodoId = todoId; },
  }))

  // 计划确认：复杂请求先呈现计划供用户批准（审批走 tool-approval 通道）
  tools.submit_plan = createSubmitPlanTool(config.sessionState.todoStore, config.conversationId)

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
    tools.delete_wiki = createDeleteWikiTool({
      wikiBaseDir: config.wikiBaseDir,
    })
  }

  // 注册 Memory 工具（需要 memoryBaseDir）
  if (config.memoryBaseDir) {
    tools.save_memory = createSaveMemoryTool({
      memoryBaseDir: config.memoryBaseDir,
    })
    tools.delete_memory = createDeleteMemoryTool({
      memoryBaseDir: config.memoryBaseDir,
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
  // connectorToolNameSet 与 tools 同为可变引用：connector 工具在 agent 工具
  // 创建之后才注册，靠引用共享让子 Agent 的工具分类看到完整集合。
  const connectorToolNameSet = new Set<string>()
  const agentToolConfig = {
    parentTools: tools,
    connectorToolNames: connectorToolNameSet,
    parentModel: config.model,
    parentSystemPrompt: '',
    parentMessages: config.parentMessages ?? [],
    writerRef: config.writerRef ?? { current: null },
    // todo 自动同步：子 Agent 带 todoId 启动时置 in_progress，结束时置 completed/failed
    todoStore: config.sessionState.todoStore,
    // 路径 B 归档：子 Agent 完成入队 pendingArchiveRetries（与 pipeline prepareStep 读的同一 Map）
    pendingArchiveRetries: config.sessionState.pendingArchiveRetries,
    cwd: config.sessionState.projectRoot,
    agentsLayoutDirs: config.sessionState.layout.resources.agents,
    provider: config.provider,
    modelAliases: config.modelAliases,
    agents: customAgents,
    agentRegistry,
    configDir: config.sessionState.layout.configDir,
    dynamicReload: config.dynamicReload ?? false,
    compactionConfig: config.compactionConfig,
    // 子 Agent 总 token 预算上限（随模型上下文伸缩；create.ts loadAllTools 计算传入，
    // 缺省未传时 executor 不设 stopWhen 预算闸门）
    maxTotalTokens: config.maxTotalTokens,
    // 子 Agent 输出预算上限（父 Agent 穿下来的 outputTokens，缺省回落默认）
    maxOutputTokens: config.maxOutputTokens,
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
      // 共享 registry 优先（即使当前配置为空——registry 可能已被 syncServers 热注入）；
      // 无共享 registry 时按本次配置新建 per-request registry。
      const sharedRegistry = config.mcpRegistry
      const activeRegistry = sharedRegistry ?? (mcpConfigs.length > 0 ? createMcpRegistry(mcpConfigs, {
        oauthDataDir: config.sessionState.layout.dataDir,
        oauthRedirectUrl: `http://127.0.0.1:${process.env.PORT ?? '3000'}/api/mcp/oauth/callback`,
      }) : undefined)
      if (activeRegistry) {
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

              // registry 绑定包装器：每次调用经 registry.callToolSafe 取活连接，
              // 带超时 + 半死连接强制重连重试（治 -32001）
              tools[qualifiedName] = createRegistryBoundMcpTool(
                toolDef as Tool,
                serverName,
                toolName,
                activeRegistry,
                { ...wrapOptions, qualifiedName },
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
          connectorToolNameSet.add(toolName)
        }
      }
    } catch (error) {
      logger.error('Connector', 'Failed to load tools:', error)
    }
  }

  return { tools, mcpRegistry, isSharedMcpRegistry, connectorToolNames }
}
