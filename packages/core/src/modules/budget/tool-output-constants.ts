// ============================================================
// Tool Output Constants - 共享常量和类型
// ============================================================
// 从 tool-output-manager.ts 提取，打破 tool-output-manager ↔ tool-result-storage 循环依赖。
// 两个模块都从这里导入共享符号，不再互相引用。

import { PREVIEW_SIZE_CHARS } from '../../services/config/defaults';

/** 持久化输出 XML 标签 */
export const PERSISTED_OUTPUT_TAG = '<persisted-output>'
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'

/** 内容清除标记（用于 MicroCompact） */
export const TOOL_RESULT_CLEARED_MESSAGE = '[Old tool result content cleared]'

/**
 * 工具输出配置
 */
export interface ToolOutputConfig {
  /** 最大字符数 */
  maxResultSizeChars: number
  /** 最大 Token 数 */
  maxResultTokens?: number
  /** 单轮消息中所有工具结果总额上限（字符） */
  messageBudget?: number
  /** 持久化预览内容大小（字符） */
  previewSizeChars?: number
}

/**
 * 持久化结果
 */
export interface PersistedToolResult {
  filepath: string
  originalSize: number
  preview: string
  hasMore: boolean
}

/**
 * 内容替换状态
 */
export interface ContentReplacementState {
  /** 已处理过的工具调用 ID */
  seenIds: Set<string>
  /** 持久化后的预览内容（tool_use_id -> preview string） */
  replacements: Map<string, string>
}

export function getPreviewSizeLimit(sessionConfig?: ToolOutputConfig): number {
  const override = sessionConfig?.previewSizeChars
  if (typeof override === 'number' && override > 0) {
    return override
  }
  return PREVIEW_SIZE_CHARS
}
