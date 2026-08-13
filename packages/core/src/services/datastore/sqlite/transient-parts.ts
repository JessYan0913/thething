// ============================================================
// Transient Parts — 瞬态 UI part 定义与剥离
// ============================================================
// 瞬态 UI part 类型：流式期间实时显示（走 SSE，不经 message-store），
// 持久化后无意义——前端渲染一律 return null，重载恢复有独立兜底来源
// （todo → /api/todos，上下文水位 → conversations.context_usage）。
// 写入时剥离，避免 DB 无限膨胀。data-sub-* 保留（子 Agent 过程回看）。
//
// 权威定义：message-store 写入剥离、doctor 诊断计数、prune 脚本清理
// 均以此为准（prune-messages.mjs 的副本需与之保持同步）。

import type { UIMessage } from 'ai';

export const TRANSIENT_PART_TYPES = new Set([
  'data-todo-update',
  'data-bash-output',
  'data-context-usage',
  'data-compaction-status',
]);

/** 剥离瞬态 data-* part；无变化时返回原引用。 */
export function stripTransientParts(message: UIMessage): UIMessage {
  if (!message.parts?.length) return message;
  const parts = message.parts.filter((p) => !TRANSIENT_PART_TYPES.has(p.type));
  return parts.length === message.parts.length ? message : { ...message, parts };
}
