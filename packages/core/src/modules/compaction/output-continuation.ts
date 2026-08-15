// ============================================================
// Output Continuation - 输出截断检测与续写（输出侧）
// ============================================================
// 见 docs/compaction-redesign.md §10 / docs/context-usage-redesign.md §14.1（P0）。
// 纯函数部分（可单测）；流式续写循环在 app/api/chat/route.ts 组装。
//
// 背景：模型输出被 provider 截断（finishReason='length'）时，ToolLoopAgent
// 会把半截文本当最终答案、run 仍 committed → 任务静默未完成。
// 检测截断后：不按"完成"收尾 + 自动续写（把已产出文本追加为 user 消息，
// 要求接续不重写），直到真正写完或累计输出预算用尽。
//
// 安全：不设段数上限（不限制"能写多少"，长输出可以一直续写到写完），
// 只设累计输出 token 预算——防"截断→续写→再截断"的病态死循环烧钱。
// 正常长文（几千 token）远够不到预算；只有模型反复截断停不下来才会被拦。

/**
 * 续写累计输出预算（tokens）：跨所有续写段累计 outputTokens，达到即视为
 * 最后一段（仍截断则标记 output_truncated）。这是成本护栏，不是写作上限。
 */
export const MAX_CONTINUATION_TOTAL_TOKENS = 64_000;

/** 续写提示（作为 user 消息追加，要求接续不重写） */
export const CONTINUATION_PROMPT =
  '（上次输出被截断）请从你刚才写到的位置继续，不要重复前面内容。';

/**
 * 模型输出是否被 provider 截断（输出预算耗尽）。
 * AI SDK 的 FinishReason 中 'length' 即截断信号。
 */
export function isOutputTruncated(finishReason: string | undefined): boolean {
  return finishReason === 'length';
}
