// ============================================================
// Message Utility Functions
// ============================================================
// 仅保留 ToolResultOutput 格式的解析工具，不做消息格式适配。
// ModelMessage 使用 .content 数组，UIMessage 使用 .parts 数组，
// 各消费方直接操作对应的字段，不需经过此模块抽象。
// ============================================================

/**
 * 获取工具结果输出内容的字符串表示
 * 兼容 ToolResultOutput 格式：{ type: 'text', value: string } | { type: 'json', value: JSONValue }
 * 也兼容原始 string / object 格式
 */
export function getToolOutputString(output: unknown): string {
  if (!output) return '';
  if (typeof output === 'string') return output;

  // ToolResultOutput: { type, value }
  if (typeof output === 'object' && output !== null && 'type' in (output as Record<string, unknown>)) {
    const typed = output as { type: string; value: unknown };
    if (typed.type === 'text' && typeof typed.value === 'string') return typed.value;
    if (typed.type === 'json') {
      try {
        return typeof typed.value === 'string' ? typed.value : JSON.stringify(typed.value);
      } catch {
        return '';
      }
    }
    if (typeof (typed as Record<string, unknown>).value === 'string') {
      return (typed as Record<string, unknown>).value as string;
    }
    return '';
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/**
 * 解包 ToolResultOutput 格式，返回实际值。
 * 如果输出不是 ToolResultOutput 格式，原样返回。
 */
export function unwrapOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type === 'string' && 'value' in obj) {
    return obj.value;
  }
  return raw;
}
