// ============================================================
// Agent 后处理 — 两条路径（直接 API + Connector 入站）共享
// ============================================================

import type { UIMessage } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { DataStore } from '../primitives/datastore/types'
import type { McpRegistry } from '../modules/mcp/registry'
import { generateConversationTitle } from '../modules/compaction'
import { maybeCheckpointAfterRun } from '../modules/compaction/checkpoint'
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
  /**
   * Whether this run still owns the active conversation path. Superseded runs
   * still persist their own cost and release resources, but must not update
   * title/checkpoint or other active-conversation projections.
   */
  commitConversationState?: boolean
  /** 后台 checkpoint 摘要参数（提供时，活跃路径超水位线则在后台生成摘要落库） */
  checkpoint?: {
    modelName: string
    contextLimit?: number
    fallbackModels?: LanguageModelV3[]
    /** 当前步数（用于步数触发 checkpoint，>20 步触发） */
    stepCount?: number
    /** 本会话压缩次数（用于压缩次数触发 checkpoint，>3 次触发） */
    compactionCount?: number
  }
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
  const commitConversationState = opts.commitConversationState ?? true

  // 保底：run 结束后同步生成 checkpoint（消除异步竞态）。
  // 之前 setImmediate 后台 fire-and-forget——LLM 摘要慢，快速连续 run 时下一轮
  // load-time 的 applyCheckpointOnLoad 拿不到刚生成的 checkpoint，回退全量历史
  // → CONTEXT_BUDGET_EXCEEDED（长时任务暴涨场景）。同步后每轮 run 结束、用户能发
  // 下一条之前摘要已落库，load-time 必然命中。触发条件（水位线 0.5 / 步数 / 压缩
  // 次数）内短 run 无 LLM 调用；大 run 结束等待摘要，换取下一轮不再拒绝。
  if (commitConversationState && opts.checkpoint && opts.model) {
    try {
      const activeMessages = dataStore.messageStore.getMessagesByConversation(conversationId)
      await maybeCheckpointAfterRun(activeMessages, {
        conversationId,
        dataStore,
        model: opts.model,
        fallbackModels: opts.checkpoint.fallbackModels,
        modelName: opts.checkpoint.modelName,
        contextLimit: opts.checkpoint.contextLimit,
        stepCount: opts.checkpoint.stepCount,
        compactionCount: opts.checkpoint.compactionCount,
      })
    } catch (e) {
      // checkpoint 失败不阻断收尾（下次 run 结束再试）
      logger.warn('FinalizeAgentRun', `Sync checkpoint failed: ${e}`)
    }
  }

  // 后台任务
  setImmediate(async () => {
    try {
      // 首次对话生成标题
      if (commitConversationState && opts.isNewConversation) {
        generateConversationTitle(messages, opts.model)
          .then(title => {
            dataStore.conversationStore.updateConversationTitle(conversationId, title)
          })
          .catch(e => logger.warn('FinalizeAgentRun', `Title generation failed: ${e}`))
      }

      // 成本持久化（只调一次）
      await costTracker.persistToDB()

      // MCP 清理（仅清理非共享的 per-request registry；共享 registry 由
      // AppContext 管理生命周期。调用方须传 ownedMcpRegistry——共享时传 null）
      if (mcpRegistry) {
        await mcpRegistry.disconnectAll()
      }
    } catch (e) {
      logger.warn('FinalizeAgentRun', `Post-processing error: ${e}`)
    }
  })
}
