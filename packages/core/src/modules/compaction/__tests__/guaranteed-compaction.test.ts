import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PipelineMessage } from '../../../services/config/compaction-types';
import { compactBeforeStep } from '../index';
import { compressMessagesDeterministic, forceTruncateMessages } from '../message-compressor';
import { emergencySummarize } from '../emergency-summary';

// ============================================================
// 集成测试：4 层压缩流程保证永不返回 413
// ============================================================

function userMsg(text: string): PipelineMessage {
  return { role: 'user', content: text } as PipelineMessage;
}

function assistantMsg(text: string): PipelineMessage {
  return { role: 'assistant', content: text } as PipelineMessage;
}

function toolMsg(output: string): PipelineMessage {
  return { role: 'tool', content: output } as PipelineMessage;
}

function generateLongConversation(length: number): PipelineMessage[] {
  const msgs: PipelineMessage[] = [userMsg('任务目标：请分析项目架构并提出优化建议。')];
  for (let i = 0; i < length; i++) {
    const t = `分析 ${i}: ${'代码优化建议'.repeat(50)}`;
    msgs.push(assistantMsg(t));
    if (i < length - 1) {
      msgs.push(toolMsg("executed npm test exit code 0"));
      msgs.push(userMsg(`继续分析第 ${i + 1} 个模块`));
    }
  }
  return msgs;
}

const minimalModel = {
  specificationVersion: 'v1',
  provider: 'test',
  modelId: 'claude-opus-4',
  defaultObjectGenerationMode: 'json',
  supportsUrl: vi.fn(),
  doGenerate: vi.fn(),
} as any;

const mockDataStore = {
  summaryStore: {
    getSummaryByConversation: () => null,
    saveSummary: () => {},
  },
} as any;

describe('集成测试：保证压缩成功', () => {
  it('正常短对话不会被压缩', async () => {
    const msgs = [userMsg('Hi'), assistantMsg('Hello')];
    const result = await compactBeforeStep(msgs, undefined, {
      model: minimalModel,
      modelName: 'claude-opus-4',
      conversationId: 'int-1',
      dataStore: mockDataStore,
      tools: { test_tool: { description: 'test' } as any, bash: { description: 'bash' } as any },
      instructions: 'test instructions',
      contextLimit: 128000,
    });
    expect(result).toHaveLength(2);
  });

  it('Layer 2 能处理的场景不触发紧急压缩', async () => {
    const msgs = [
      userMsg('目标'),
      toolMsg('x'.repeat(50000)),
      toolMsg('y'.repeat(50000)),
      assistantMsg('好的，已处理'),
    ];
    const result = await compactBeforeStep(msgs, undefined, {
      model: minimalModel,
      modelName: 'claude-opus-4',
      conversationId: 'int-2',
      dataStore: mockDataStore,
      tools: { bash: { description: 'bash' } as any },
      instructions: 'test',
      contextLimit: 10000,
    });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('Layer 2.5 确定性压缩处理长对话', async () => {
    const msgs = generateLongConversation(30);
    const result = await compactBeforeStep(msgs, undefined, {
      model: minimalModel,
      modelName: 'claude-opus-4',
      conversationId: 'int-3',
      dataStore: mockDataStore,
      tools: { bash: { description: 'bash' } as any },
      instructions: 'x'.repeat(5000),
      contextLimit: 5000,
    });
    expect(result.length).toBeLessThanOrEqual(15);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain('任务目标');
  });

  it('极端长对话永不返回 413', async () => {
    const msgs = generateLongConversation(200);
    const result = await compactBeforeStep(msgs, undefined, {
      model: minimalModel,
      modelName: 'claude-opus-4',
      conversationId: 'int-4',
      dataStore: mockDataStore,
      tools: { bash: { description: 'bash' } as any },
      instructions: 'x'.repeat(5000),
      contextLimit: 2000,
    });
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].role).toBe('user');
    expect(result.length).toBeLessThan(msgs.length * 0.1);
  });

  it('线性扩展：对话越长压缩率越高', async () => {
    const lengths = [10, 50, 100];
    for (const len of lengths) {
      const msgs = generateLongConversation(len);
      const result = await compactBeforeStep(msgs, undefined, {
        model: minimalModel,
        modelName: 'claude-opus-4',
        conversationId: "int-scale-" + len,
        dataStore: mockDataStore,
        tools: { bash: { description: 'bash' } as any },
        instructions: 'x'.repeat(2000),
        contextLimit: 3000,
      });
      expect(result.length).toBeLessThan(msgs.length * 0.3);
      expect(result[0].role).toBe('user');
    }
  });
});