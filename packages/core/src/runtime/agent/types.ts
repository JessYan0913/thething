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
  writerRef?: { current: SubAgentStreamWriter | null }
  model: any // LanguageModelV3
  /** Model provider for creating sub-agent models (fast/smart) */
  provider?: (modelName: string) => any
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
}

export interface CreateAgentConfig {
  conversationId: string
  messages?: UIMessage[]
  userId?: string
  teamId?: string
  modelConfig: ModelProviderConfig
  sessionOptions?: SessionStateOptions
  conversationMeta?: {
    messageCount: number
    isNewConversation: boolean
    conversationStartTime: number
  }
  enableMcp?: boolean
  enableSkills?: boolean
  enableMemory?: boolean
  enableConnector?: boolean
  writerRef?: { current: SubAgentStreamWriter | null }
  /** 预加载的数据（来自 AppContext），必须提供 */
  preloadedData: PreloadedData
  /** 行为配置（来自 AppContext.behavior），用于消除硬编码 */
  behaviorDefaults?: BehaviorConfig
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