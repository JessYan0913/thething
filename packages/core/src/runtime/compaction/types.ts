// ============================================================
// Compaction - Type Definitions
// ============================================================

// ── Configuration ──

export interface CompactionConfig {
  lifecycle: LifecycleConfig;
  contextWindow: ContextWindowConfig;
}

export interface LifecycleConfig {
  /** 完整保留最近 N 轮的工具输出（默认 3） */
  keepRecentTurns: number;
  /** 大输出阈值：超过此字符数的工具输出即使在最近 N 轮内也被压缩（默认 8000） */
  largeOutputThreshold: number;
  /** 可压缩的工具名集合。为 null 时使用默认规则（内置工具 + mcp_* + connector_*） */
  compactableTools: Set<string> | null;
  /** 不可压缩的工具名集合，优先级高于 compactableTools（默认为空） */
  protectedTools: Set<string>;
}

export interface ContextWindowConfig {
  /** 触发 Layer 3 摘要的利用率百分比（默认 0.85） */
  triggerPercent: number;
  /** 摘要后的目标利用率百分比（默认 0.60） */
  targetPercent: number;
  /** 摘要 prompt 中保留的上下文提示消息数（默认 2） */
  contextHintMessages: number;
  /** 是否启用增量摘要（默认 true） */
  incrementalSummary: boolean;
}

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

// ── Compaction Result ──

export interface CompactionResult {
  messages: import('ai').UIMessage[];
  executed: boolean;
  tokensFreed: number;
  actions: string[];
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
