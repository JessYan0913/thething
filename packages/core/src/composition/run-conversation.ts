// ============================================================
// Run Conversation — conversation_runs 台账骨架（双引擎共享）
// ============================================================
// Phase E：route.ts(Web) 与 agent-handler.ts(Connector) 各自手写
// "开账(createRun) → 落库(appendMessages) → 结算(finishRun)" 三步，
// 语义一致但状态漂移（resultTipId 解析、终态推导互不相同）。
// 本模块收敛为 run 生命周期公共骨架：
//   startConversationRun     开账 createRun；expectedTipId 恒锚定 anchorMessageId
//   commitAssistantMessages  落库助手输出（CAS：head 已移走即迟到无害孤儿）并解析最新 tip
//   endConversationRun       结算：按 headMoved 推导 committed/superseded，或显式终态
// 各引擎只保留各自传输层（SSE 泵 / 审批挂起恢复 / 循环退出判定）。

import type { UIMessage } from 'ai'
import type { DataStore } from '../primitives/datastore/types'

export interface StartConversationRunInput {
  /** 本轮运行 id：由调用方提前生成（Web 端用于 abort 注册、Connector 用于循环状态），台账与之一致 */
  id: string
  conversationId: string
  /** 本轮输入锚点：普通轮为刚提交的 user/assistant 消息 id；续跑/审批恢复为挂起点消息 id */
  anchorMessageId: string | null
  branchId?: string | null
  model?: string | null
  agentType?: string | null
}

/**
 * 开篇：创建 conversation_runs 台账记录，返回 runId。
 * expectedTipId 固定等于 anchorMessageId —— 本轮期望从该锚点续写。
 * 台账子存储缺失时（最小化测试 store）静默跳过，不阻断本轮执行。
 */
export function startConversationRun(dataStore: DataStore, input: StartConversationRunInput): string {
  dataStore.conversationRunStore?.createRun({
    id: input.id,
    conversationId: input.conversationId,
    branchId: input.branchId ?? null,
    anchorMessageId: input.anchorMessageId ?? null,
    expectedTipId: input.anchorMessageId ?? null,
    model: input.model ?? null,
    agentType: input.agentType ?? null,
  })
  return input.id
}

export interface CommitAssistantMessagesResult {
  /** head 是否仍在我们这个锚点上（否则本轮为迟到孤儿，未成为活跃路径） */
  headMoved: boolean
  /** 本段落库后的最新 tip：head 移动后取活跃路径 tip，否则取本段最后一条消息 id */
  resultTipId: string | null
}

/**
 * 落库一段助手输出并解析最新 tip。appendMessages 的 CAS 语义使
 * 迟到的写入成为无害孤儿分支，不污染活跃路径。
 */
export function commitAssistantMessages(
  dataStore: DataStore,
  conversationId: string,
  messages: UIMessage[],
  afterMessageId?: string,
): CommitAssistantMessagesResult {
  const headMoved = dataStore.messageStore.appendMessages(conversationId, messages, afterMessageId)
  // branchStore 缺失时（最小化测试 store）退回本段最后一条消息 id
  let resultTipId: string | null = messages.at(-1)?.id ?? null
  if (headMoved) {
    resultTipId = dataStore.branchStore?.getProjection(conversationId)?.activeTipId ?? resultTipId
  }
  return { headMoved, resultTipId }
}

export interface EndConversationRunInput {
  /** 显式终态；省略时按 headMoved 推导 committed/superseded */
  status?: 'committed' | 'superseded' | 'aborted' | 'failed'
  headMoved?: boolean
  resultTipId?: string | null
  error?: string | null
}

/**
 * 结算一轮 run。常规完成 → committed/superseded；中断/失败 → 显式 aborted/failed 带错误。
 */
export function endConversationRun(
  dataStore: DataStore,
  runId: string,
  input: EndConversationRunInput,
): void {
  const status = input.status ?? (input.headMoved ? 'committed' : 'superseded')
  dataStore.conversationRunStore?.finishRun(runId, {
    status,
    resultTipId: input.resultTipId ?? null,
    error: input.error ?? null,
  })
}