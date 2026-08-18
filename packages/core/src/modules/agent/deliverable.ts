// ============================================================
// Sub-Agent Deliverable Contract - 子Agent 交付物契约校验（P0 产出传递）
// ============================================================
// 设计框架（§1.3 待设计对齐 P0）：
//   1. 契约定义：子Agent 的 summary 必须包含实质交付物（最终结论 + 关键证据），
//      而非仅过程日志/空结果，主Agent 才能正确理解并归档。
//   2. 交付物校验：子Agent 完成时校验 summary 满足契约。
//   3. 失败处理：不满足契约时降级（重新委派 / 透明说明）。
//
// 本模块实现契约的**保守启发式**：只拦截明确无交付物的情况——
//   - 空/空白 summary
//   - executor 的兜底文案（无文本强制摘要失败后的 fallbackSummary）
// 不设长度/关键词启发：中文短结论（如"任务完成"）是合法交付物，误伤会造成
// 用户可见的降级，比不校验更糟。过程叙述类产出由指令层（buildSubAgentPrompt
// 的 Output Guidelines）在源头约束，校验层只兜底明确失败。

/** executor 兜底文案（无文本强制摘要失败/无步骤时产生）——明确非交付物 */
const NO_DELIVERABLE_PATTERNS: RegExp[] = [
  /No text summary was produced/,
  /Agent completed with no text output/,
];

/**
 * 判断子Agent summary 是否构成实质交付物。
 * 返回 false 表示：空结果，或命中 executor 兜底文案（明确无交付物）。
 * 返回 true 表示：有实质内容（保守，不误伤正常产出）。
 */
export function isSubstantiveDeliverable(summary: string | undefined | null): boolean {
  if (!summary || summary.trim().length === 0) return false;
  return !NO_DELIVERABLE_PATTERNS.some((p) => p.test(summary));
}
