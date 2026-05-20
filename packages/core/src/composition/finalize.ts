// ============================================================
// Agent 后处理 — 两条路径（直接 API + Connector 入站）共享
// ============================================================

import type { UIMessage } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { DataStore } from '../primitives/datastore/types'
import type { McpRegistry } from '../modules/mcp/registry'
import type { EntrypointLimits } from '../modules/memory/memdir'
import { extractMemoriesInBackground } from '../modules/memory'
import { generateConversationTitle } from '../modules/compaction'
import { logger } from '../primitives/logger'

export interface FinalizeAgentRunOptions {
  /** DataStore 实例 */
  dataStore: DataStore
  /** 要保存的最终消息列表（调用方负责过滤/切片） */
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
  /** 记忆基础目录（getPrimaryMemoryDir 的结果） */
  memoryBaseDir?: string
  /** 用户 ID */
  userId?: string
  /** 记忆入口文件限制 */
  entrypointLimits?: EntrypointLimits
}

/**
 * Agent 运行完成后的统一后处理。
 *
 * 职责（按顺序）：
 * 1. 保存消息到 DataStore
 * 2. 后台提取记忆（延迟 3 秒避免限速）
 * 3. 首次对话生成标题
 * 4. 持久化成本数据
 * 5. 断开 MCP 连接
 *
 * 注意：成本持久化和 MCP 清理只调一次，避免 double-persist。
 */
export async function finalizeAgentRun(opts: FinalizeAgentRunOptions): Promise<void> {
  const { dataStore, messages, conversationId, costTracker, mcpRegistry } = opts

  // 1. 保存消息
  dataStore.messageStore.saveMessages(conversationId, messages)

  // 2-5. 后台任务
  setImmediate(async () => {
    try {
      // 记忆提取（内部已有 3 秒延迟）
      extractMemoriesInBackground(
        messages,
        opts.userId ?? 'default',
        conversationId,
        opts.model,
        opts.memoryBaseDir,
        opts.entrypointLimits,
      ).catch(e => logger.warn('FinalizeAgentRun', `Memory extraction failed: ${e}`))

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

      // MCP 清理
      if (mcpRegistry) {
        await mcpRegistry.disconnectAll()
      }
    } catch (e) {
      logger.warn('FinalizeAgentRun', `Post-processing error: ${e}`)
    }
  })
}
