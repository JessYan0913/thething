// ============================================================
// Compaction - Type Definitions
// ============================================================

// Re-export shared types from services layer
import type { CompactionConfig, LifecycleConfig, ContextWindowConfig } from '../../services/config/compaction-types';
export type { CompactionConfig, LifecycleConfig, ContextWindowConfig } from '../../services/config/compaction-types';
export type { CompactionResult } from '../../services/config/compaction-types';

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  keepRecentTurns: 3,
  largeOutputThreshold: 8000,
  compactableTools: null,
  protectedTools: new Set(),
};

export const DEFAULT_CONTEXT_WINDOW_CONFIG: ContextWindowConfig = {
  triggerPercent: 0.85,
  targetPercent: 0.60,
  contextHintMessages: 2,
  incrementalSummary: true,
};

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  lifecycle: DEFAULT_LIFECYCLE_CONFIG,
  contextWindow: DEFAULT_CONTEXT_WINDOW_CONFIG,
};

// ── Tool Output Compression ──

export interface CompactedToolResult {
  /** 结构化元信息摘要 */
  summary: string;
  /** 标记：已压缩，防止重复处理 */
  _compacted: true;
  /** 原始输出大小（chars），用于遥测 */
  _originalSize: number;
}

// ── Default Compactable Tools ──
// 使用代码库中的实际工具名（首字母大写）

export const DEFAULT_COMPACTABLE = new Set([
  'Read',
  'Bash',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'WebSearch',
  'WebFetch',
  // 小写别名（兼容旧格式）
  'read_file',
  'bash',
  'grep',
  'glob',
  'edit_file',
  'write_file',
  'web_search',
  'web_fetch',
]);
