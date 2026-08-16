// ============================================================
// Compaction - Unified Tool Output Hook
// ============================================================
// 所有工具（内置/MCP/Connector/Skill）执行后经过同一处理入口。
// 收编原 processToolOutput (tool-output-manager.ts) 的内联截断
// 和 budget/message-budget.ts 的跨消息预算检查。
// 见 docs/compaction-redesign.md
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
 * 对齐 Claude Code：
 * - 失败输出（bash exitCode≠0 / error）→ 结论行 + 头尾预览（错误常在尾部）
 * - 成功输出 → 头部预览
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

  // 超阈值 → 判断成败（决定结论行 + 预览模式）
  const { conclusion, previewMode } = extractOutputConclusion(output);

  // 持久化到磁盘
  const sessionId = options?.sessionId ?? `temp-${Date.now()}`;
  const dataDir = options?.dataDir ?? process.cwd();

  try {
    const result = await persistToolResult(content, toolCallId, sessionId, dataDir, options?.config, previewMode, conclusion);
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

/**
 * 从工具输出提取结论（成败 + 关键信息）与预览模式。
 * 失败（exitCode≠0 / error）→ 结论 + 头尾预览；成功 → 结论 + 头部预览。
 */
function extractOutputConclusion(output: unknown): {
  conclusion?: string;
  previewMode: 'head' | 'head-tail';
} {
  if (output && typeof output === 'object') {
    const r = output as Record<string, unknown>;
    if (typeof r.exitCode === 'number') {
      return r.exitCode !== 0
        ? { conclusion: `exit=${r.exitCode}`, previewMode: 'head-tail' }
        : { conclusion: 'exit=0', previewMode: 'head' };
    }
    if (r.error !== undefined || r.success === false) {
      const err = typeof r.error === 'string'
        ? r.error
        : (typeof r.message === 'string' ? r.message : 'failed');
      return { conclusion: `error: ${err.slice(0, 120)}`, previewMode: 'head-tail' };
    }
    if (r.success === true) return { conclusion: 'success', previewMode: 'head' };
  }
  return { previewMode: 'head' };
}
