// ============================================================
// Compaction Configuration Types
// Shared between services/config (behavior) and modules/compaction
// ============================================================

/**
 * 流水线消息类型。pipeline 运行时传递的是 ModelMessage(.content 数组),
 * 而 DB/app 边界处是 UIMessage(.parts 数组)。compaction/budget 的多数函数
 * 在转换之后运行、按 .content 操作,少数(如按 .parts 的 token 估算)两种都要处理。
 * 用这个 union 作为流水线侧签名,取代此前遍布调用点的 `as unknown as` 强转。
 * 见 docs/context-compaction-analysis.md #4 与执行计划 8.9。
 */
export type PipelineMessage = import('ai').UIMessage | import('ai').ModelMessage;

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

export interface CompactionConfig {
  lifecycle: LifecycleConfig;
}

export interface CompactionResult {
  messages: PipelineMessage[];
  executed: boolean;
  tokensFreed: number;
  actions: string[];
}
