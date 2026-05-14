// ============================================================
// Message Budget - 消息级工具结果预算检查
// ============================================================
// 参考 Claude Code 的 enforceToolResultBudget
// 防止 N 个工具同时返回大输出，总额超过限制
// ============================================================

import type { UIMessage } from 'ai'
import {
  getMessageBudgetLimit,
  type ContentReplacementState,
  type ContentReplacementRecord,
  type ToolOutputOverrides,
  TOOL_RESULT_CLEARED_MESSAGE,
} from './tool-output-manager'
import { persistToolResult, buildPersistedOutputMessage, formatSize } from './tool-result-storage'

// ============================================================
// 类型定义
// ============================================================

/**
 * 工具结果候选（待处理）
 */
interface ToolResultCandidate {
  toolUseId: string
  content: string
  size: number
  toolName: string
}

/**
 * 预算检查结果
 */
export interface BudgetCheckResult {
  messages: UIMessage[]
  newlyPersisted: ContentReplacementRecord[]
  tokensSaved: number
  totalBefore: number
  totalAfter: number
}

// ============================================================
// 核心函数：消息级预算检查
// ============================================================

/**
 * 执行消息级工具结果预算检查
 *
 * 算法：
 * 1. 收集本轮所有 tool_result
 * 2. 按 size 大小排序
 * 3. 最大的先持久化，直到总额低于预算
 * 4. 使用 seenIds 保证相同决策（prompt cache 稳定）
 *
 * @param messages 消息数组
 * @param state 内容替换状态
 * @param sessionId 会话 ID
 * @param projectDir 项目目录
 * @param skipToolNames 跳过的工具名称集合
 */
export async function enforceToolResultBudget(
  messages: UIMessage[],
  state: ContentReplacementState,
  sessionId: string,
  projectDir: string,
  skipToolNames: ReadonlySet<string> = new Set(),
  sessionConfig?: ToolOutputOverrides,
): Promise<BudgetCheckResult> {
  const limit = getMessageBudgetLimit(sessionConfig)
  const candidates = collectCandidatesByMessage(messages)
  const newlyPersisted: ContentReplacementRecord[] = []
  let tokensSaved = 0
  let totalBefore = 0
  let totalAfter = 0

  // 计算当前总额
  for (const candidate of candidates) {
    totalBefore += candidate.size
  }

  // 如果总额在预算内，无需处理
  if (totalBefore <= limit) {
    return {
      messages,
      newlyPersisted: [],
      tokensSaved: 0,
      totalBefore,
      totalAfter: totalBefore,
    }
  }

  // 按 size 降序排序
  const sortedCandidates = [...candidates].sort((a, b) => b.size - a.size)

  // 处理候选，直到总额低于预算
  let currentTotal = totalBefore
  const messagesToModify = new Map<number, Map<string, string>>()

  for (const candidate of sortedCandidates) {
    // 跳过已处理的（保证稳定性）
    if (state.seenIds.has(candidate.toolUseId)) {
      // 如果之前已持久化，复用预览
      const existingReplacement = state.replacements.get(candidate.toolUseId)
      if (existingReplacement) {
        const savings = candidate.size - existingReplacement.length
        tokensSaved += savings
        currentTotal -= savings
      }
      continue
    }

    // 跳过指定工具
    if (skipToolNames.has(candidate.toolName)) {
      continue
    }

    // 如果仍在预算外，持久化此候选
    if (currentTotal > limit) {
      const result = await persistToolResult(
        candidate.content,
        candidate.toolUseId,
        sessionId,
        projectDir
      )

      const message = buildPersistedOutputMessage(result)
      const savings = candidate.size - message.length

      // 记录状态
      state.seenIds.add(candidate.toolUseId)
      state.replacements.set(candidate.toolUseId, message)

      // 记录新持久化
      newlyPersisted.push({
        kind: 'tool-result',
        toolUseId: candidate.toolUseId,
        replacement: message,
      })

      tokensSaved += savings
      currentTotal -= savings

      console.log(
        `[Message Budget] Persisted ${candidate.toolUseId}: saved ${formatSize(savings)}, remaining budget: ${formatSize(currentTotal)}/${formatSize(limit)}`
      )
    }
  }

  totalAfter = currentTotal

  // 如果没有新的持久化，返回原消息
  if (newlyPersisted.length === 0) {
    return {
      messages,
      newlyPersisted: [],
      tokensSaved,
      totalBefore,
      totalAfter,
    }
  }

  // 修改消息中的 tool_result 内容
  const modifiedMessages = applyReplacements(messages, newlyPersisted)

  return {
    messages: modifiedMessages,
    newlyPersisted,
    tokensSaved,
    totalBefore,
    totalAfter,
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 收集消息中的所有工具结果候选
 */
function collectCandidatesByMessage(messages: UIMessage[]): ToolResultCandidate[] {
  const candidates: ToolResultCandidate[] = []

  for (const message of messages) {
    if (!message.parts || !Array.isArray(message.parts)) {
      continue
    }

    for (const part of message.parts) {
      // 检查是否是 tool_result 类型
      if (part.type === 'tool-result' || part.type === 'dynamic-tool') {
        const partData = part as unknown as Record<string, unknown>
        const toolUseId = (partData.tool_use_id as string) || (partData.toolCallId as string)
        const content = partData.content || partData.output

        if (toolUseId && content) {
          const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
          const toolName = (partData.name as string) || extractToolNameFromId(toolUseId)

          candidates.push({
            toolUseId,
            content: contentStr,
            size: contentStr.length,
            toolName,
          })
        }
      }
    }
  }

  return candidates
}

/**
 * 从 tool_use_id 中提取工具名称（简化版）
 */
function extractToolNameFromId(toolUseId: string): string {
  // tool_use_id 格式通常是 UUID，无法直接提取工具名
  // 这里返回默认值，实际工具名需要从 assistant message 的 tool_use 中获取
  return 'unknown'
}

/**
 * 应用替换到消息
 */
function applyReplacements(
  messages: UIMessage[],
  replacements: ContentReplacementRecord[]
): UIMessage[] {
  const replacementMap = new Map<string, string>()
  for (const r of replacements) {
    replacementMap.set(r.toolUseId, r.replacement)
  }

  return messages.map((message) => {
    if (!message.parts || !Array.isArray(message.parts)) {
      return message
    }

    let modified = false
    const newParts = message.parts.map((part) => {
      if (part.type === 'tool-result' || part.type === 'dynamic-tool') {
        const partData = part as unknown as Record<string, unknown>
        const toolUseId = (partData.tool_use_id as string) || (partData.toolCallId as string)

        if (toolUseId && replacementMap.has(toolUseId)) {
          modified = true
          return {
            ...part,
            content: replacementMap.get(toolUseId),
          }
        }
      }
      return part
    })

    if (!modified) {
      return message
    }

    return { ...message, parts: newParts }
  })
}

// ============================================================
// 快速预算估算（不执行持久化）
// ============================================================

/**
 * 快速估算消息的工具结果总额
 * 用于提前预警
 */
export function estimateToolResultsTotal(
  messages: UIMessage[],
  sessionConfig?: ToolOutputOverrides,
): {
  totalChars: number
  totalTokens: number
  isOverBudget: boolean
  percentUsed: number
} {
  const candidates = collectCandidatesByMessage(messages)
  const totalChars = candidates.reduce((sum, c) => sum + c.size, 0)
  const totalTokens = Math.ceil(totalChars / 3.5) // 粗略估算
  const limit = getMessageBudgetLimit(sessionConfig)
  const isOverBudget = totalChars > limit
  const percentUsed = Math.min(100, (totalChars / limit) * 100)

  return {
    totalChars,
    totalTokens,
    isOverBudget,
    percentUsed,
  }
}

// ============================================================
// 工具名称映射构建（用于 skipToolNames）
// ============================================================

/**
 * 从消息中构建 tool_use_id -> toolName 的映射
 */
export function buildToolNameMap(messages: UIMessage[]): Map<string, string> {
  const nameMap = new Map<string, string>()

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.parts) {
      continue
    }

    for (const part of message.parts) {
      if (part.type === 'tool-use' || part.type === 'dynamic-tool') {
        const partData = part as unknown as Record<string, unknown>
        const toolCallId = (partData.id as string) || (partData.toolCallId as string)
        const toolName = (partData.name as string) || (partData.toolName as string)

        if (toolCallId && toolName) {
          nameMap.set(toolCallId, toolName)
        }
      }
    }
  }

  return nameMap
}