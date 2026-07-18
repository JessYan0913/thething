import { describe, it, expect } from 'vitest';
import { createSubAgentPrepareStep, isTokenBudgetExceeded } from '../executor';
import { DEFAULT_COMPACTION_CONFIG } from '../../compaction/types';
import type { ModelMessage } from 'ai';

// ============================================================
// 子 Agent 压缩管线 + token 预算测试
// ============================================================

/** 构造一条含 tool-result 的 ModelMessage */
function toolResultMessage(toolName: string, output: string, toolCallId = 'tc-1'): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId,
        toolName,
        output: { type: 'text', value: output },
      },
    ],
  } as unknown as ModelMessage;
}

describe('createSubAgentPrepareStep', () => {
  it('compacts old tool outputs beyond keepRecentSteps (Layer 2)', async () => {
    const prepareStep = createSubAgentPrepareStep(DEFAULT_COMPACTION_CONFIG);

    // 5 步 bash 输出（bash 在 DEFAULT_COMPACTABLE 中），每步中等大小
    // keepRecentSteps 默认 3 → 前 2 条应被压缩
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: `tc-${i}`, toolName: 'Bash', input: {} }],
      } as unknown as ModelMessage);
      messages.push(toolResultMessage('Bash', `output line ${i}\n`.repeat(200), `tc-${i}`));
    }

    const result = await prepareStep({ messages } as never);
    const outMessages = (result as { messages: ModelMessage[] }).messages;

    expect(outMessages).toHaveLength(messages.length);

    // 前 2 条 tool-result 应被替换为压缩元信息（_compacted 标记）
    const toolMsgs = outMessages.filter((m) => m.role === 'tool');
    const compactedFlags = toolMsgs.map((m) => {
      const item = (m.content as Array<Record<string, unknown>>)[0];
      return item._compacted === true;
    });
    expect(compactedFlags.slice(0, 2)).toEqual([true, true]);
    // 最近 3 条保持原样
    expect(compactedFlags.slice(2)).toEqual([false, false, false]);
  });

  it('returns messages unchanged when nothing to compact', async () => {
    const prepareStep = createSubAgentPrepareStep(DEFAULT_COMPACTION_CONFIG);
    const messages: ModelMessage[] = [
      { role: 'user', content: 'hello' } as ModelMessage,
      { role: 'assistant', content: 'hi' } as ModelMessage,
    ];

    const result = await prepareStep({ messages } as never);
    const outMessages = (result as { messages: ModelMessage[] }).messages;
    expect(outMessages).toEqual(messages);
  });
});

describe('isTokenBudgetExceeded', () => {
  function stepWithUsage(totalTokens: number) {
    return { usage: { totalTokens } } as never;
  }

  it('returns false when accumulated usage is under budget', async () => {
    const condition = isTokenBudgetExceeded(10_000);
    const result = await condition({
      steps: [stepWithUsage(3000), stepWithUsage(4000)],
    } as never);
    expect(result).toBe(false);
  });

  it('returns true when accumulated usage reaches budget', async () => {
    const condition = isTokenBudgetExceeded(10_000);
    const result = await condition({
      steps: [stepWithUsage(6000), stepWithUsage(4000)],
    } as never);
    expect(result).toBe(true);
  });

  it('tolerates steps with missing usage', async () => {
    const condition = isTokenBudgetExceeded(10_000);
    const result = await condition({
      steps: [{ usage: undefined } as never, stepWithUsage(5000)],
    } as never);
    expect(result).toBe(false);
  });
});
