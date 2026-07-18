import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { UIMessage } from 'ai';
import { manageToolOutputLifecycle } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';
import { getToolResultPath } from '../../budget/tool-result-storage';

// ============================================================
// 步骤 7 验收:Layer 2 压缩落盘可恢复
// 见 docs/compaction-execution-plan.md 步骤 7
// ============================================================

function createUserMessage(text: string): UIMessage {
  return { id: `u-${Date.now()}`, role: 'user', content: [{ type: 'text', text }] } as unknown as UIMessage;
}

function createToolMessage(toolName: string, output: unknown, toolCallId: string): UIMessage {
  return {
    id: `a-${toolCallId}`,
    role: 'tool',
    content: [{ type: 'tool-result', toolName, toolCallId, output: { type: 'json', value: output } }],
  } as unknown as UIMessage;
}

function getResultItem(msg: UIMessage): any {
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
    const fullContent = 'x'.repeat(10000);
    const messages = [
      createUserMessage('Q1'),
      createToolMessage('read_file', { path: 'src/big.ts', content: fullContent }, 'tc-1'),
      createUserMessage('Q2'),
      createToolMessage('read_file', { path: 'src/recent.ts', content: 'y'.repeat(300) }, 'tc-2'),
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
    expect(item._compacted).toBe(true);
    expect(item.output.value).not.toContain('saved to:');
  });
});
