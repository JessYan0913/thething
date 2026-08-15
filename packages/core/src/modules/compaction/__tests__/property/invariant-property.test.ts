import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { ModelMessage } from 'ai';
import { manageToolOutputLifecycle } from '../../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../../types';
import { extractActionLog } from '../../action-log';

// ============================================================
// 性质测试:随机对话 + 不变式断言(防未知 bug,不只抓见过的)
// 见 docs/compaction-redesign.md
// ============================================================
// 用 fast-check 生成随机 UIMessage 对话(随机工具/输入/输出大小/错误),
// 跑 manageToolOutputLifecycle,断言四条不变式在所有随机场景下成立。

const TOOL_NAMES = ['read_file', 'bash', 'web_fetch', 'grep', 'glob'] as const;

/** 一条工具结果 UIMessage part */
function toolPart(toolName: string, toolCallId: string, input: unknown, output: string, isError: boolean) {
  return {
    type: `tool-${toolName}` as any,
    toolCallId,
    state: 'output-available',
    input,
    output: { type: 'text' as const, value: isError ? `Error: ${output}` : output },
  };
}

/** 工具输入(key)--对应工具名的合理形状 */
const inputGen = fc.oneof(
  fc.record({ filePath: fc.string({ minLength: 1, maxLength: 40 }) }),
  fc.record({ url: fc.string({ minLength: 1, maxLength: 40 }) }),
  fc.record({ command: fc.string({ minLength: 1, maxLength: 40 }) }),
  fc.record({ path: fc.string({ minLength: 1, maxLength: 40 }) }),
);

/** 工具输出(value)--随机大小,模拟从短到超长 */
const outputGen = fc.record({
  content: fc.string({ maxLength: 20000 }),
  isError: fc.boolean(),
});

/** 一条带工具结果的消息(assistant + tool part) */
const toolMessageGen = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }).map(s => `m-${s}`),
  toolName: fc.constantFrom(...TOOL_NAMES),
  toolCallId: fc.string({ minLength: 1, maxLength: 10 }).map(s => `tc-${s}`),
  input: inputGen,
  output: outputGen,
}).map(({ id, toolName, toolCallId, input, output }) => ({
  id,
  role: 'assistant' as const,
  parts: [toolPart(toolName, toolCallId, input, output.content, output.isError)],
})) as unknown as fc.Arbitrary<ModelMessage>;

/** 一条文本消息(user/assistant) */
const textMessageGen = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }).map(s => `t-${s}`),
  role: fc.constantFrom('user', 'assistant'),
  text: fc.string({ maxLength: 1000 }),
}).map(({ id, role, text }) => ({
  id, role,
  parts: [{ type: 'text' as const, text }],
})) as unknown as fc.Arbitrary<ModelMessage>;

/** 随机对话:首条 user + 随机混合文本/工具消息 */
const conversationGen = fc.tuple(textMessageGen, fc.array(fc.oneof(toolMessageGen, textMessageGen), { maxLength: 25 }))
  .map(([first, rest]) => {
    const all = [first, ...rest];
    // 给每个 tool part 分配唯一 toolCallId:fast-check 的 fc.string 随机碰撞会产生
    // 重复 id,导致快照断言(INV-A)按 id 匹配时失真偶发失败(见 2026-08-14 复现)。
    // 属性测试只关心 id 唯一性,不依赖具体值。
    let idx = 0;
    for (const m of all) {
      const parts = (m as unknown as { parts?: any[] }).parts;
      if (!Array.isArray(parts)) continue;
      for (const p of parts) {
        if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
          p.toolCallId = `tc-${idx++}`;
        }
      }
    }
    return all;
  });

/** 从消息里抽取所有 tool part 的 (id, input, isError) 快照 */
interface ToolSnapshot { toolCallId: string; input: unknown; isError: boolean; }
function snapshotTools(messages: ModelMessage[]): ToolSnapshot[] {
  const out: ToolSnapshot[] = [];
  for (const m of messages) {
    const parts = (m as unknown as { parts?: any[] }).parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p.type === 'string' && (p.type.startsWith('tool-') || p.type === 'dynamic-tool') && p.state === 'output-available') {
        const isError = typeof p.output === 'string'
          ? p.output.startsWith('Error:')
          : JSON.stringify(p.output ?? '').includes('Error:');
        out.push({ toolCallId: p.toolCallId, input: p.input, isError });
      }
    }
  }
  return out;
}

describe('compaction invariants (property-based)', () => {
  // CI 速度优先;numRuns 适中,fast-check 自带 shrinking 找最小反例。
  const RUNS = 50;

  it('INV-A: key(工具调用 input)永不被驱逐', () => {
    fc.assert(fc.property(conversationGen, (messages) => {
      const before = snapshotTools(messages);
      const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);
      const after = snapshotTools(result.messages);
      // 每条 tool 的 input 压缩前后必须一致(key 保留)
      for (const b of before) {
        const a = after.find(x => x.toolCallId === b.toolCallId);
        if (!a) continue; // 理论上不会丢(message 树保留),但 input 字段必须一致
        expect(a.input).toEqual(b.input);
      }
    }), { numRuns: RUNS });
  });

  it('INV-B: 当前步(最后一条工具结果)永不 meta 化', () => {
    fc.assert(fc.property(conversationGen, (messages) => {
      const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);
      // 找最后一条含 tool-result 的消息
      let lastToolMsg: ModelMessage | undefined;
      for (const m of result.messages) {
        const parts = (m as unknown as { parts?: any[] }).parts;
        if (Array.isArray(parts) && parts.some(p => typeof p.type === 'string' && p.type.startsWith('tool-'))) {
          lastToolMsg = m;
        }
      }
      if (!lastToolMsg) return;
      const parts = (lastToolMsg as unknown as { parts: any[] }).parts;
      for (const p of parts) {
        if (typeof p.type === 'string' && p.type.startsWith('tool-') && p.state === 'output-available') {
          // 当前步可 _truncated(可见截断),但绝不能 _compacted(meta 化)
          expect(p._compacted).not.toBe(true);
        }
      }
    }), { numRuns: RUNS });
  });

  it('INV-D: 错误结果永不被压缩', () => {
    fc.assert(fc.property(conversationGen, (messages) => {
      const before = snapshotTools(messages);
      const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);
      const after = snapshotTools(result.messages);
      for (const b of before) {
        if (!b.isError) continue;
        const a = after.find(x => x.toolCallId === b.toolCallId);
        if (!a) continue;
        // 错误结果对应的 part 不应有 _compacted
        const part = findToolPart(result.messages, b.toolCallId);
        if (part) expect(part._compacted).not.toBe(true);
      }
    }), { numRuns: RUNS });
  });

  it('INV-C: 压缩后消息数 <= 输入(永不膨胀)', () => {
    fc.assert(fc.property(conversationGen, (messages) => {
      const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);
      // 消息数不应增加(压缩只替换 part,不增消息)
      expect(result.messages.length).toBeLessThanOrEqual(messages.length);
      // 总字符数不应增加
      const beforeLen = JSON.stringify(messages).length;
      const afterLen = JSON.stringify(result.messages).length;
      expect(afterLen).toBeLessThanOrEqual(beforeLen);
    }), { numRuns: RUNS });
  });
});

function findToolPart(messages: ModelMessage[], toolCallId: string): any {
  for (const m of messages) {
    const parts = (m as unknown as { parts?: any[] }).parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (p.toolCallId === toolCallId) return p;
    }
  }
  return undefined;
}
