// ============================================================
// Agent Types - 统一的 Agent 创建类型定义
// ============================================================

import type { UIMessage, Tool } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { SessionStateOptions, SessionState } from '../session-state'
import type { ModelProviderConfig } from '../../foundation/model'
import type { McpRegistry } from '../../extensions/mcp'
import type { SubAgentStreamWriter } from '../../extensions/subagents'

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
}

export interface CreateAgentResult {
  agent: any // ToolLoopAgent
  sessionState: SessionState
  mcpRegistry?: McpRegistry
  tools: Record<string, Tool>
  instructions: string
  /** 预算检查后调整的消息（如果有调整） */
  adjustedMessages?: UIMessage[]
  /** 预算检查执行的降级动作列表 */
  budgetActions?: string[]
  /** 模型实例（未包装 middleware），供后台任务使用 */
  model?: LanguageModelV3
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