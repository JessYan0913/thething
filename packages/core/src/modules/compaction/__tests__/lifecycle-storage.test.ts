import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { UIMessage } from 'ai';
import type { ModelMessage } from 'ai';
import { manageToolOutputLifecycle } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';
import { getToolResultPath } from '../../budget/tool-result-storage';

// ============================================================
// 步骤 7 验收:Layer 2 压缩落盘可恢复
// 见 docs/compaction-redesign.md
// ============================================================

function createUserMessage(text: string): ModelMessage {
  return { id: `u-${Date.now()}`, role: 'user', content: [{ type: 'text', text }] } as ModelMessage;
}

function createToolMessage(toolName: string, output: unknown, toolCallId?: string): ModelMessage {
  return {
    id: `a-${toolCallId}`,
    role: 'tool',
    content: [{ type: 'tool-result', toolName, toolCallId, output: { type: 'json', value: output } }],
  } as ModelMessage;
}

function getResultItem(msg: ModelMessage): any {
  return ((msg as unknown as Record<string, unknown>).content as any[])[0];
}

describe('Layer 2 压缩落盘可恢复', () => {
  let dataDir: string;
  const sessionId = 'test-session';

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'lifecycle-storage-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('persists compacted output to disk and embeds the path in the meta', async () => {
    // 用 bash 测落盘(bash 是瞬态输出,该落盘);read_file 不落盘(原文件已在磁盘,避免两份)
    const fullContent = 'x'.repeat(10000);
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('bash', { command: 'cat big.ts', stdout: fullContent, exitCode: 0 }, 'tc-1'),
      createUserMessage('Q2'),
      createToolMessage('bash', { command: 'echo y', stdout: 'y'.repeat(300), exitCode: 0 }, 'tc-2'),
    ];

    const result = manageToolOutputLifecycle(
      messages,
      { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 },
      { sessionId, dataDir },
    );

    // 等待异步落盘完成
    expect(result.persistence).toBeDefined();
    await result.persistence;

    // 旧输出被压缩,元信息里带 saved to 路径
    const item = getResultItem(result.messages[1]);
    expect(item._compacted).toBe(true);
    expect(item.output.value).toContain('saved to:');

    // 落盘文件内容 = 原始完整输出,可通过 read_file 找回
    const expectedPath = getToolResultPath('tc-1', sessionId, dataDir, true);
    const saved = await readFile(expectedPath, 'utf-8');
    expect(saved).toContain(fullContent);
  });

  it('does not persist when no storage is provided (lossy fallback)', () => {
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('read_file', { path: 'a.ts', content: 'x'.repeat(10000) }, 'tc-1'),
      createUserMessage('Q2'),
    ];

    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 });

    expect(result.persistence).toBeUndefined();
    const item = getResultItem(result.messages[1]);
    // 当前步豁免 meta -> 可见截断(read_file 无 storage 时不落盘,仅省略中段)
    expect(item._truncated).toBe(true);
    expect(item.output.value).not.toContain('saved to:');
  });
});

// ============================================================
// 发送前 step 级智能舍弃（治本：不动落库记录）
// 见 lifecycle.ts slimAssistantMessage / slimOversizedMessages
// ============================================================
import { slimAssistantMessage, slimOversizedMessages } from '../lifecycle';
import { estimateMessageTokens } from '../token-counter';

function stepParts(prefix: string, size: number): any[] {
  return [
    { type: 'step-start' },
    { type: 'reasoning', id: `r-${prefix}`, text: `${prefix}-reasoning-`.repeat(size) },
    { type: 'text', text: `${prefix}-text` },
    { type: 'tool-bash', toolCallId: `tc-${prefix}`, input: { command: prefix }, output: { type: 'text', value: `${prefix}-out-`.repeat(size) }, state: 'output-available' },
  ];
}

describe('slimAssistantMessage（发送前智能舍弃）', () => {
  it('超阈值巨型消息（多 step）舍弃早期 step，保留最新步骤', async () => {
    const parts = [...stepParts('a', 500), ...stepParts('b', 500), ...stepParts('c', 500)];
    const message = { id: 'big', role: 'assistant', parts } as any;
    const before = await estimateMessageTokens(message, 'unknown-model');
    expect(before).toBeGreaterThan(2000);

    const slimmed = await slimAssistantMessage(message, 2000, 'unknown-model');
    const after = await estimateMessageTokens(slimmed as any, 'unknown-model');
    expect(after).toBeLessThanOrEqual(2000);
    // 最新步骤（c）保留——最近行动可感知
    const keptParts = (slimmed as any).parts;
    expect(keptParts.some((p: any) => p.type === 'tool-bash' && p.toolCallId === 'tc-c')).toBe(true);
  });

  it('不超阈值时原样返回', async () => {
    const message = { id: 'small', role: 'assistant', parts: stepParts('x', 10) } as any;
    const slimmed = await slimAssistantMessage(message, 25_000, 'unknown-model');
    expect(slimmed).toBe(message);
  });
});

describe('slimOversizedMessages', () => {
  it('只处理超阈值的消息，其余原样保留', async () => {
    const small = { id: 's', role: 'assistant', parts: stepParts('x', 10) } as any;
    const big = { id: 'b', role: 'assistant', parts: [...stepParts('a', 500), ...stepParts('b', 500), ...stepParts('c', 500)] } as any;
    const result = await slimOversizedMessages([small, big], 10_000, 'unknown-model');
    // small 原样
    expect(result[0]).toBe(small);
    // big 被压到 ≤ 窗口 20%（2000）
    const tokens = await estimateMessageTokens(result[1] as any, 'unknown-model');
    expect(tokens).toBeLessThanOrEqual(2000);
  });
});
