import { describe, it, expect, vi } from 'vitest';
import type { PipelineMessage } from '../../../services/config/compaction-types';
import { emergencySummarize } from '../emergency-summary';

// ============================================================
// Layer 3: 紧急 LLM 摘要测试
// ============================================================

// Mock generateText
vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: '## 用户目标\n测试任务\n## 已完成步骤\n步骤 1\n## 涉及的文件\nsrc/index.ts\n## 当前状态\n完成',
  }),
}));

function userMsg(text: string): PipelineMessage {
  return { role: 'user', content: text } as PipelineMessage;
}

function assistantMsg(text: string): PipelineMessage {
  return { role: 'assistant', content: text } as PipelineMessage;
}

const mockModel = {
  specificationVersion: 'v1',
  provider: 'test',
  modelId: 'claude-haiku-4',
  defaultObjectGenerationMode: 'json',
  supportsUrl: vi.fn(),
  doGenerate: vi.fn(),
};

function longConversation(count: number): PipelineMessage[] {
  const msgs: PipelineMessage[] = [userMsg('任务目标：重构模块 A')];
  for (let i = 0; i < count; i++) {
    msgs.push(assistantMsg(`第 ${i} 步分析结果`));
  }
  return msgs;
}

describe('emergencySummarize', () => {
  it('中间消息太少时跳过', async () => {
    const msgs = [userMsg('Hi'), assistantMsg('Hello')];
    const result = await emergencySummarize(msgs, {
      model: mockModel as any,
      targetPercent: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('调用 LLM 生成摘要并替换中间消息', async () => {
    const msgs = longConversation(30);
    const result = await emergencySummarize(msgs, {
      model: mockModel as any,
      targetPercent: 0.6,
    });
    expect(result.success).toBe(true);
    expect(result.messages.length).toBeLessThan(msgs.length);
    expect(result.messages[0].role).toBe('user');
  });

  it('摘要失败时回退并报告错误', async () => {
    const { generateText } = await import('ai');
    // reject 2 次（generateSummaryFast 尝试 2 次）
    (generateText as any)
      .mockRejectedValueOnce(new Error('API error 1'))
      .mockRejectedValueOnce(new Error('API error 2'));
    const msgs = longConversation(30);
    const result = await emergencySummarize(msgs, {
      model: mockModel as any,
      targetPercent: 0.6,
    });
    expect(result.success).toBe(false);
    expect(result.messages).toHaveLength(msgs.length);
  });

  it('超时保护正常触发', async () => {
    const { generateText } = await import('ai');
    (generateText as any).mockImplementationOnce(() =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 1000)
      )
    );
    const msgs = longConversation(30);
    const result = await emergencySummarize(msgs, {
      model: mockModel as any,
      targetPercent: 0.6,
      timeoutMs: 50,
    });
    expect(result.success).toBe(false);
  });
});