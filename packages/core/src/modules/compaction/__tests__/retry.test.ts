import { describe, it, expect, beforeEach } from 'vitest';
import { handleReactiveRetry } from '../retry';
import { getEstimatorInfra } from '../tokenizer';

beforeEach(() => getEstimatorInfra().calibrator.clear());

const ctxLengthError = new Error(
  "This model's maximum context length is 128000 tokens. However, you requested 131000 tokens. context_length_exceeded",
);

describe('handleReactiveRetry', () => {
  it('re-throws non-context-length errors untouched', async () => {
    const err = new Error('some unrelated failure');
    await expect(
      handleReactiveRetry(err, [], undefined, {
        modelName: 'unknown-model',
        conversationId: 'c1',
        dataStore: {} as never,
      }),
    ).rejects.toThrow('some unrelated failure');
  });

  it('throws a diagnostic CONTEXT_BUDGET_EXCEEDED when aggressive Layer 2 still cannot fit the window', async () => {
    // 大文本不被 Layer 2 压缩 → 100k tokens 远超大窗口 12.8k
    const big = { role: 'user' as const, content: 'word '.repeat(80_000) };
    await expect(
      handleReactiveRetry(ctxLengthError, [big], undefined, {
        modelName: 'unknown-model',
        conversationId: 'c1',
        dataStore: {} as never,
        contextLimit: 12_800,
        instructions: 'system instructions',
        tools: {},
      }),
    ).rejects.toThrow(/CONTEXT_BUDGET_EXCEEDED/);
  });

  it('returns compressed messages when aggressive Layer 2 brings the request under the window', async () => {
    // 大工具输出（50k chars read_file）被 Layer 2 截断/压缩 → 总量回落到窗口内
    const msgs = [
      { role: 'user' as const, content: 'hi' },
      {
        role: 'user' as const,
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 'read_file', output: 'x'.repeat(50_000) },
        ],
      },
    ];
    const result = await handleReactiveRetry(ctxLengthError, msgs, undefined, {
      modelName: 'unknown-model',
      conversationId: 'c1',
      dataStore: {} as never,
      contextLimit: 128_000,
    });
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('diagnostic error includes the breakdown when instructions/tools are provided', async () => {
    const big = { role: 'user' as const, content: 'word '.repeat(80_000) };
    const err = await handleReactiveRetry(ctxLengthError, [big], undefined, {
      modelName: 'unknown-model',
      conversationId: 'c1',
      dataStore: {} as never,
      contextLimit: 12_800,
      instructions: 'sys',
      tools: {},
    }).then(() => null).catch((e: Error) => e);
    expect(err).not.toBeNull();
    expect(String(err!.message)).toMatch(/msgs=/);
    expect(String(err!.message)).toMatch(/inst=/);
  });
});
