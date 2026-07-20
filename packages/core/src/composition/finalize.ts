// ============================================================
// Agent 后处理 — 两条路径（直接 API + Connector 入站）共享
// ============================================================

import type { UIMessage } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { DataStore } from '../primitives/datastore/types'
import type { McpRegistry } from '../modules/mcp/registry'
import { generateConversationTitle } from '../modules/compaction'
import { logger } from '../primitives/logger'

export interface FinalizeAgentRunOptions {
  /** DataStore 实例 */
  dataStore: DataStore
  /** 最终消息列表（仅用于标题生成；消息落库由调用方通过 MessageStore 原语完成） */
  messages: UIMessage[]
  /** 对话 ID */
  conversationId: string
  /** 成本追踪器（调用 persistToDB） */
  costTracker: { persistToDB(): Promise<void>; getSummary(): { totalCostUsd: number; inputTokens: number; outputTokens: number } }
  /** MCP 注册表（调用 disconnectAll） */
  mcpRegistry?: McpRegistry | null
  /** 用于记忆提取和标题生成的语言模型（可选，无模型时跳过记忆提取和标题生成） */
  model?: LanguageModelV3
  /** 是否为首次对话（触发标题生成） */
  isNewConversation: boolean
  /** 知识库基础目录 */
  wikiBaseDir?: string
  /** 用户 ID */
  userId?: string
}

/**
 * Agent 运行完成后的统一后处理。
 *
 * 职责（按顺序）：
 * 1. 首次对话生成标题
 * 2. 持久化成本数据
 * 3. 断开 MCP 连接
 *
 * 消息落库不在此处：调用方在流结束时用 messageStore.appendMessages /
 * commitUserMessage 增量写入（不可变消息树，见 message-store.ts）。
 *
 * 注意：成本持久化和 MCP 清理只调一次，避免 double-persist。
 */
export async function finalizeAgentRun(opts: FinalizeAgentRunOptions): Promise<void> {
  const { dataStore, messages, conversationId, costTracker, mcpRegistry } = opts

  // 后台任务
  setImmediate(async () => {
    try {
      // 首次对话生成标题
      if (opts.isNewConversation) {
        generateConversationTitle(messages, opts.model)
          .then(title => {
            dataStore.conversationStore.updateConversationTitle(conversationId, title)
          })
          .catch(e => logger.warn('FinalizeAgentRun', `Title generation failed: ${e}`))
      }

      // 成本持久化（只调一次）
      await costTracker.persistToDB()

      // MCP 清理（仅清理非共享的 per-request registry；共享 registry 由 AppContext 管理生命周期）
      if (mcpRegistry) {
        await mcpRegistry.disconnectAll()
      }
    } catch (e) {
      logger.warn('FinalizeAgentRun', `Post-processing error: ${e}`)
    }
  })
}
