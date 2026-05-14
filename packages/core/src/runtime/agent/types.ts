// ============================================================
// Agent Types - 统一的 Agent 创建类型定义
// ============================================================

import type { UIMessage, Tool } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { SessionStateOptions, SessionState } from '../session-state'
import type { ModelProviderConfig } from '../../foundation/model'
import type { McpRegistry } from '../../extensions/mcp'
import type { SubAgentStreamWriter } from '../../extensions/subagents'
import type { Skill } from '../../extensions/skills/types'
import type { AgentDefinition } from '../../extensions/subagents/types'
import type { McpServerConfig } from '../../extensions/mcp/types'
import type { ConnectorFrontmatter } from '../../extensions/connector/loader'
import type { PermissionRule } from '../../extensions/permissions/types'
import type { MemoryEntry } from '../../api/loaders/memory'
import type { DataStore } from '../../foundation/datastore/types'
import type { BehaviorConfig } from '../../config/behavior'
import type { ConnectorRegistry } from '../../extensions/connector'
import type { ResolvedLayout } from '../../config/layout'
import type { ToolOutputOverrides } from '../budget/tool-output-manager'

// ============================================================
// AgentModules - 模块开关（已解析，全部 required boolean）
// ============================================================

export interface AgentModules {
  skills: boolean
  mcps: boolean
  memory: boolean
  connectors: boolean
  permissions: boolean
  compaction: boolean
}

// ============================================================
// ResolvedAgentConfig - 统一解析后的配置
// ============================================================
// 把 CreateAgentOptions + BehaviorConfig 收敛成一份明确的解析结果，
// 让 api/app/create.ts 到 runtime/agent/create.ts 的链路不再手写白名单截断。
// 公开配置新增字段时，只需在 resolveAgentConfig() 中补逻辑，
// 不需要在多层对象里重复补拷贝。

export interface ResolvedAgentConfig {
  /** 模型配置（已从 ModelConfig 转换为 ModelProviderConfig） */
  modelConfig: ModelProviderConfig
  /** 模块开关（全部已解析为 boolean，默认 true） */
  modules: AgentModules
  /** Session 参数（已完整组装：behavior 默认值 + session 覆盖 + compaction 合并） */
  sessionOptions: SessionStateOptions
  /** 行为配置（完整 BehaviorConfig，供 runtime 消费点直接取值） */
  behavior: BehaviorConfig
  /** 布局配置（已解析为绝对路径） */
  layout: ResolvedLayout
  /** 工具输出覆盖（已从 ToolOutputLimitsConfig 转换为 ToolOutputOverrides） */
  toolOutputOverrides: ToolOutputOverrides
}

export interface AgentContextConfig {
  userId?: string
  teamId?: string
  conversationMeta?: {
    messageCount: number
    isNewConversation: boolean
    conversationStartTime: number
  }
}

export interface LoadToolsConfig {
  conversationId: string
  sessionState: SessionState
  enableMcp?: boolean
  enableConnector?: boolean
  connectorRegistry?: ConnectorRegistry
  writerRef?: { current: SubAgentStreamWriter | null }
  model: any // LanguageModelV3
  /** Model provider for creating sub-agent models (fast/smart) */
  provider?: (modelName: string) => any
  /** 预加载的 Agent 定义（来自 AppContext 快照） */
  agents?: AgentDefinition[]
  /** 预加载的 MCP 配置（来自 AppContext 快照） */
  mcps?: McpServerConfig[]
  /** 模型别名映射（来自 BehaviorConfig.modelAliases） */
  modelAliases?: BehaviorConfig['modelAliases']
}

/**
 * 预加载的数据（来自 AppContext）
 * 用于避免 createChatAgent 内部重复调用 loadAll
 */
export interface PreloadedData {
  cwd: string
  skills: Skill[]
  agents: AgentDefinition[]
  mcps: McpServerConfig[]
  connectors: ConnectorFrontmatter[]
  permissions: PermissionRule[]
  memory: MemoryEntry[]
  /** DataStore 实例（来自 CoreRuntime，必填） */
  dataStore: DataStore
  /** ConnectorRegistry 实例（来自 CoreRuntime） */
  connectorRegistry?: ConnectorRegistry
}

export interface CreateAgentConfig {
  conversationId: string
  messages?: UIMessage[]
  userId?: string
  teamId?: string
  conversationMeta?: {
    messageCount: number
    isNewConversation: boolean
    conversationStartTime: number
  }
  writerRef?: { current: SubAgentStreamWriter | null }
  /** 预加载的数据（来自 AppContext），必须提供 */
  preloadedData: PreloadedData
  /** 统一解析后的配置（包含模型、模块、session、行为、布局） */
  resolvedConfig: ResolvedAgentConfig
}

export interface CreateAgentResult {
  agent: any // ToolLoopAgent
  sessionState: SessionState
  mcpRegistry?: McpRegistry
  tools: Record<string, Tool>
  instructions: string
  /** 预算检查后调整的消息（包含注入的附件） */
  adjustedMessages?: UIMessage[]
  /** 预算检查执行的降级动作列表 */
  budgetActions?: string[]
  /** 模型实例（未包装 middleware），供后台任务使用 */
  model?: LanguageModelV3
  /** 附件注入信息 */
  attachmentInfo?: {
    hasSkillListing: boolean
    skillListingCount: number
  }
  /**
   * 释放本次对话占用的所有资源
   * - 持久化成本数据
   * - 等待后台压缩（可选）
   * - 断开 MCP 连接
   */
  dispose(options?: { waitForCompaction?: boolean }): Promise<void>
}

export interface SkillResolution {
  activeSkillNames: Set<string>
  activeSkills: Array<{
    name: string
    body: string
    allowedTools: string[]
    model?: string
  }>
  activeToolsWhitelist: Set<string> | null
  activeModelOverride: string | null
}

export interface MemoryContext {
  userId: string
  teamId?: string
  recalledMemoriesContent?: string
}