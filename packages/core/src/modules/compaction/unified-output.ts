// ============================================================
// Compaction - Unified Tool Output Hook
// ============================================================
// 所有工具（内置/MCP/Connector/Skill）执行后经过同一处理入口。
// 收编原 processToolOutput (tool-output-manager.ts) 的内联截断
// 和 budget/message-budget.ts 的跨消息预算检查。
// 见 docs/context-invariant-architecture.md §7。
// ============================================================

import {
  getToolOutputConfig,
  type ToolOutputConfig,
} from '../budget/tool-output-manager';
import { persistToolResult, buildPersistedOutputMessage } from '../budget/tool-result-storage';
import { getToolOutputString } from './message-utils';
import { logger } from '../../primitives/logger';

/**
 * 统一工具输出处理结果
 */
export interface UnifiedOutputResult {
  /** 处理后的内容（可能为预览文本或原内容） */
  content: string;
  /** 是否已持久化到磁盘 */
  persisted: boolean;
  /** 持久化后的文件路径 */
  filepath?: string;
  /** 原始内容大小 */
  originalSize: number;
}

/**
 * 统一工具输出钩子——所有工具执行后必须经此处理。
 *
 * 规则：
 * - 输出 ≤ 阈值 → 原样返回（persisted: false）
 * - 输出 > 阈值 → 落盘 + 返回预览（persisted: true, 带 filepath）
 *
 * @param output 工具返回的原始输出
 * @param toolName 工具名（用于查找工具专属阈值配置）
 * @param toolCallId 工具调用 ID（用于持久化关联）
 * @param options 可选：会话信息（提供时落盘可找回）
 */
export async function unifiedToolOutputHook(
  output: unknown,
  toolName: string,
  toolCallId: string,
  options?: {
    sessionId?: string;
    dataDir?: string;
    config?: ToolOutputConfig;
  },
): Promise<UnifiedOutputResult> {
  const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  const originalSize = content.length;
  const toolConfig = getToolOutputConfig(toolName, options?.config);

  // 未超阈值 → 原样
  if (originalSize <= toolConfig.maxResultSizeChars) {
    return { content, persisted: false, originalSize };
  }

  // 超阈值 → 持久化到磁盘
  const sessionId = options?.sessionId ?? `temp-${Date.now()}`;
  const dataDir = options?.dataDir ?? process.cwd();

  try {
    const result = await persistToolResult(content, toolCallId, sessionId, dataDir, options?.config);
    const message = buildPersistedOutputMessage(result, !options?.sessionId, options?.config);

    return {
      content: message,
      persisted: true,
      filepath: result.filepath,
      originalSize,
    };
  } catch (err) {
    logger.warn('UnifiedOutput', `Persist failed for ${toolCallId}:`, err);
    // 落盘失败 → 返回截断后的内容（安全降级）
    const preview = content.slice(0, toolConfig.previewSizeChars ?? 2000);
    return {
      content: `${preview}...\n[Note: Full output (${originalSize} chars) exceeded limit. Persistence failed.]`,
      persisted: false,
      originalSize,
    };
  }
}
