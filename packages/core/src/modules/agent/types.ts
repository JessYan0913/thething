// ============================================================
// Agent Types - 统一的 Agent 创建类型定义
// ============================================================

import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { SessionStateOptions, SessionState } from '../session'
import type { ModelProviderConfig } from '../../services/model'
import type { SubAgentStreamWriter } from '../../modules/subagents'
import type { Skill } from '../../modules/skills/types'
import type { AgentDefinition } from '../../modules/subagents/types'
import type { McpServerConfig } from '../../modules/mcp/types'
import type { BehaviorConfig } from '../../services/config/behavior'
import type { ConnectorRegistry } from '../../modules/connector'
import type { ResolvedLayout } from '../../services/config/layout'
import type { ToolOutputConfig } from '../budget/tool-output-manager'

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
  /** 工具输出配置（已从 ToolOutputLimitsConfig 转换为 runtime 可消费对象） */
  toolOutputConfig: ToolOutputConfig
  /** 是否允许动态重载（默认 false，仅显式 opt-in 时为 true） */
  dynamicReload?: boolean
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
  model: LanguageModelV3
  /** Model provider for creating sub-agent models (fast/smart) */
  provider?: (modelName: string) => LanguageModelV3
  /** 预加载的 Agent 定义（来自 AppContext 快照） */
  agents?: AgentDefinition[]
  /** 预加载的 MCP 配置（来自 AppContext 快照） */
  mcps?: McpServerConfig[]
  /** 模型别名映射（来自 BehaviorConfig.modelAliases） */
  modelAliases?: BehaviorConfig['modelAliases']
  /** 预加载的 skills（来自 AppContext 快照） */
  skills?: Skill[]
  /** WebSearch API Key（由应用层显式传入） */
  webSearchApiKey?: string
  /** 是否开启调试日志 */
  debugEnabled?: boolean
  /** 是否允许动态重载（默认 false，仅显式 opt-in 时为 true） */
  dynamicReload?: boolean
}

export interface MemoryContext {
  userId: string
  teamId?: string
  recalledMemoriesContent?: string
}
