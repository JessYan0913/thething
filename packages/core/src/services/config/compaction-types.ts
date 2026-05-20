// ============================================================
// Compaction Configuration Types
// Shared between services/config (behavior) and modules/compaction
// ============================================================

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

export interface CompactionConfig {
  lifecycle: LifecycleConfig;
  contextWindow: ContextWindowConfig;
}

export interface CompactionResult {
  messages: import('ai').UIMessage[];
  executed: boolean;
  tokensFreed: number;
  actions: string[];
}
