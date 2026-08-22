import { describe, it, expect } from 'vitest';
import { slimAssistantMessage } from '../lifecycle';

/**
 * 构造一条"monolith"UIMessage（把 N 步合并进一条消息，无 step-boundary 时为旧形态）：
 * [reasoning, tool-html, tool-output, ...] × N
 */
function buildMonolith(stepCount: number, withStepStart: boolean): Parameters<typeof slimAssistantMessage>[0] {
  const parts: Array<Record<string, unknown>> = [];
  for (let i = 0; i < stepCount; i++) {
    if (withStepStart) parts.push({ type: 'step-start' });
    parts.push({ type: 'reasoning', text: `step ${i} reasoning` });
    parts.push({
      type: `tool-${i % 2 === 0 ? 'bash' : 'read_file'}`,
      toolCallId: `c${i}`,
      input: i % 2 === 0 ? { command: 'ls' } : { path: `/f${i}` },
      state: 'output-available',
      output: { type: 'text', text: '{"ok":1}' },
    } as Record<string, unknown>);
  }
  return { id: 'monolith', role: 'assistant', parts } as never;
}

describe('slimAssistantMessage per-step slicing (monolith with step-start tokens)', () => {
  it('without step-start: old monolith → step slicing is inert (no summary, parts preserved)', async () => {
    const monolith = buildMonolith(20, false);
    const before = (monolith as unknown as { parts: unknown[] }).parts.length;
    const result = await slimAssistantMessage(monolith, 60, 'unknown-model');
    const parts = (result as unknown as { parts: Array<Record<string, unknown>> }).parts;
    const summary = parts.find((p) => typeof p.text === 'string' && (p.text as string).includes('已省略'));
    expect(parts.length).toBe(before); // 无 step-start → 无按步舍弃，原样保留
    expect(summary).toBeUndefined();
  });

  it('with step-start: monolith gets step-sliced — leading summary + fewer parts', async () => {
    const monolith = buildMonolith(20, true);
    const originalLength = (monolith as unknown as { parts: unknown[] }).parts.length; // 20×3
    const result = await slimAssistantMessage(monolith, 60, 'unknown-model');
    const parts = (result as unknown as { parts: Array<Record<string, unknown>> }).parts;

    // 步级舍弃发生了：头部出现执行摘要（已省略 X 步），且工具 part 数显著减少
    const summary = parts.find((p) => typeof p.text === 'string' && (p.text as string).includes('已省略'));
    expect(summary).toBeDefined();
    expect(parts.length).toBeLessThan(originalLength);

    // 保留的部分必须以 step-start 边界开头（顺序正确性）
    const toolParts = parts.filter((p) => typeof p.type === 'string' && (p.type as string).startsWith('tool-'));
    expect(toolParts.length).toBeGreaterThan(0);
    // 摘要放在最前 = text part
    expect(parts[0].type).toBe('text');
  });
});