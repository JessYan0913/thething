// ============================================================
// Compaction Configuration Types
// Shared between services/config (behavior) and modules/compaction
// ============================================================

export interface LifecycleConfig {
  /** 完整保留最近 K 个含工具结果的 step（默认 3）。step = 一条携带 tool-result 的消息 */
  keepRecentSteps: number;
  /** 大输出阈值：超过此字符数的工具输出即使在最近 N 轮内也被压缩（默认 8000） */
  largeOutputThreshold: number;
  /** 可压缩的工具名集合。为 null 时使用默认规则（内置工具 + mcp_* + connector_*） */
  compactableTools: Set<string> | null;
  /** 不可压缩的工具名集合，优先级高于 compactableTools（默认为空） */
  protectedTools: Set<string>;
  /** 跨消息工具输出总额预算（0 = 禁用跨消息扫描，继承原 enforceToolResultBudget） */
  messageBudget?: number;
}

export interface ContextWindowConfig {
  /** 触发压缩的上下文利用率阈值（0-1），默认 0.85 */
  triggerPercent: number;
  /** 压缩目标利用率（0-1），默认 0.7 */
  targetPercent: number;
  /** 保留用于上下文提示的最近消息数，默认 3 */
  contextHintMessages: number;
  /** 是否启用增量摘要，默认 false */
  incrementalSummary: boolean;
}

export interface CompactionConfig {
  lifecycle: LifecycleConfig;
  contextWindow: ContextWindowConfig;
}

export interface CompactionResult {
  messages: import('ai').ModelMessage[];
  executed: boolean;
  tokensFreed: number;
  actions: string[];
}
