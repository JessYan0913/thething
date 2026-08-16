// ============================================================
// Message Token Cache - 消息级 token 估算缓存（精准失效）
// ============================================================
// 估算地基（见 docs/compaction-redesign.md L0）：
// 目标：避免每步 prepareStep 对未变化的历史消息反复全量 tiktoken 编码。
//
// 设计：key 用"内容敏感指纹"——压缩改写消息（输出大文本→summary）后指纹必变
// → 自然 miss → 重算，效果等价压缩层报告受影响消息的精准失效，且不依赖
// 压缩层配合。未变消息跨步骤复用，命中即省一次 encode。
//
// 注意：不能复用 compaction-view 的 fingerprintMessage（它只对 toolCallId 集合
// 敏感，压缩改写输出但 toolCallId 不变时指纹不变 → 会误命中旧 token 数）。

export interface CachedToken {
  tokens: number;
}

const MAX_ENTRIES = 5000;

export class MessageTokenCache {
  private cache = new Map<string, CachedToken>();

  get(key: string): number | undefined {
    return this.cache.get(key)?.tokens;
  }

  set(key: string, tokens: number): void {
    if (this.cache.size >= MAX_ENTRIES) {
      // 超上限：清除一半（旧条目优先，Map 迭代序 = 插入序）
      let i = 0;
      const half = Math.floor(this.cache.size / 2);
      for (const k of this.cache.keys()) {
        if (i++ >= half) break;
        this.cache.delete(k);
      }
    }
    this.cache.set(key, { tokens });
  }

  /** 显式失效（L1/L2 压缩层已知被改消息时调用，可选） */
  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/** 截断到首 N 字符，避免指纹字符串无限增长 */
function head(str: string, n: number): string {
  return str.length <= n ? str : str.slice(0, n);
}

/**
 * 内容敏感指纹：用于估算缓存 key。
 *
 * 必须覆盖 estimateMessageTokens 实际计数的全部字段，保证"指纹变 ⇔ token 数
 * 可能变"：
 * - 文本/reasoning → 总长度 + 首尾 32 字符
 * - 图片/文件 → 计数（估算按张计费）
 * - 工具调用（content tool-call / parts tool-invocation / dynamic-tool）→
 *   toolCallId + 输入(被 JSON.stringify 计入) + 输出长度与首 64 字符
 *   （压缩改写输出 → 长度/首部变化 → 指纹变 → miss）
 *
 * 同时处理两种格式：UIMessage 用 .parts（tool-invocation 输出在 .result），
 * ModelMessage 用 .content（tool-result 输出在 .output）。
 *
 * @param msg ModelMessage / UIMessage
 * @param modelName 计入 key（不同模型 encoding 不同，token 数不可复用）
 */
export function cacheFingerprint(
  msg: import('ai').ModelMessage,
  modelName?: string,
): string {
  const rec = msg as unknown as Record<string, unknown>;
  const content = rec.content;
  const rawParts = rec.parts;
  const parts = Array.isArray(rawParts)
    ? (rawParts as unknown[])
    : Array.isArray(content)
      ? content
      : [];

  const toolBits: string[] = [];
  let textLen = 0;
  let textHead = '';
  let textTail = '';
  let imageCount = 0;
  let dynamicIndex = 0;

  // 字符串 content（ModelMessage 常见形态）：长度 + 首尾片段
  if (typeof content === 'string') {
    textLen = content.length;
    textHead = head(content, 32);
    textTail = head(content.slice(-32), 32);
  }

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === 'string' ? p.type : '';

    if (type === 'tool-call') {
      // ModelMessage：工具调用输入(args) 被 JSON.stringify 计入
      const args = p.args;
      const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? '');
      toolBits.push(`c:${String(p.toolCallId ?? '')}:${argsStr.length}:${head(argsStr, 64)}`);
    } else if (type === 'tool-result') {
      const out = (p as { output?: unknown }).output;
      const outStr = typeof out === 'string' ? out : JSON.stringify(out ?? '');
      toolBits.push(`r:${String(p.toolCallId ?? '')}:${outStr.length}:${head(outStr, 64)}`);
    } else if (type === 'tool-invocation') {
      // UIMessage：输出在 .result，输入在 .args
      const res = (p as { result?: unknown }).result;
      const resStr = res === undefined || res === null ? '' : typeof res === 'string' ? res : JSON.stringify(res);
      const args = p.args;
      const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? '');
      toolBits.push(`t:${String(p.toolCallId ?? '')}:${String(p.toolName ?? '')}:${resStr.length}:${head(resStr, 64)}:${argsStr.length}:${head(argsStr, 48)}`);
    } else if (type === 'dynamic-tool') {
      const out = (p as { output?: unknown }).output;
      const outStr = typeof out === 'string' ? out : JSON.stringify(out ?? '');
      const input = (p as { input?: unknown }).input;
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input ?? '');
      toolBits.push(`d:${dynamicIndex++}:${outStr.length}:${head(outStr, 64)}:${inputStr.length}:${head(inputStr, 48)}`);
    } else if (type.startsWith('tool-')) {
      // 自定义 UIMessage 工具 part（agent-handler 构造：type: `tool-${toolName}`，
      // 字段 input/output/state/errorText）。估算器把 output+input 计入 token（见
      // token-counter estimateMessageTokens），指纹必须覆盖——否则压缩改写 output
      // 后指纹不变 → 命中旧缓存 → 重估不降（超限误报）；且所有 tool-only 消息会
      // 共享同一 key 互相污染（大消息的 token 数传染给小消息）。
      const out = (p as { output?: unknown }).output;
      const outStr = typeof out === 'string' ? out : JSON.stringify(out ?? '');
      const input = (p as { input?: unknown }).input;
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input ?? '');
      const err = (p as { errorText?: unknown }).errorText;
      const errStr = typeof err === 'string' ? err : '';
      toolBits.push(`u:${String(p.toolCallId ?? '')}:${outStr.length}:${head(outStr, 64)}:${inputStr.length}:${head(inputStr, 48)}${errStr ? `:e${errStr.length}:${head(errStr, 48)}` : ''}`);
    } else if (type === 'text' || type === 'reasoning') {
      if (typeof p.text === 'string') {
        const t = p.text;
        textLen += t.length;
        if (textHead.length < 32) textHead += head(t, 32 - textHead.length);
        if (t.length > 0) textTail = head(t.slice(-32), 32);
      }
    } else if (type === 'image' || type === 'file') {
      imageCount++;
    }
  }

  if (toolBits.length > 0 || imageCount > 0) {
    return `${modelName ?? ''}|${msg.role}|tools|${toolBits.join(',')}${imageCount > 0 ? `|img${imageCount}` : ''}`;
  }
  return `${modelName ?? ''}|${msg.role}|txt|${textLen}:${textHead}:${textTail}`;
}
