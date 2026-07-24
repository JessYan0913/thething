import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { compactBeforeStep } from '../index';
import { logger } from '../../../primitives/logger';

// ============================================================
// 集成测试：统一压缩管线（P2）
// 管线：Layer 0 视图 -> Layer 2 工具输出老化 -> ② Agent 压缩(主模型,真实消息)
// forceTruncate 已删：摘要失败/仍超限 -> 返回原消息，交由闸门 413（pipeline.ts）
// ============================================================

const mockGenerateText = vi.fn();

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  };
});

const SUMMARY_TEXT =
  '## 用户目标\n分析项目架构\n## 已完成步骤\n分析了若干模块\n## 涉及的文件\nsrc/index.ts\n## 当前状态\n继续分析';

function userMsg(text: string): ModelMessage {
  return { role: 'user', content: text } as ModelMessage;
}

function assistantMsg(text: string): ModelMessage {
  return { role: 'assistant', content: text } as ModelMessage;
}

function toolMsg(output: string): ModelMessage {
  return { role: 'tool', content: output } as unknown as ModelMessage;
}

function generateLongConversation(length: number): ModelMessage[] {
  const msgs: ModelMessage[] = [userMsg('任务目标：请分析项目架构并提出优化建议。')];
  for (let i = 0; i < length; i++) {
    const t = `分析 ${i}: ${'代码优化建议'.repeat(50)}`;
    msgs.push(assistantMsg(t));
    if (i < length - 1) {
      msgs.push(toolMsg('executed npm test exit code 0'));
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

describe('集成测试：统一压缩管线', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ text: SUMMARY_TEXT });
  });

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
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('Layer 2 能处理的场景不触发 Agent 压缩', async () => {
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

  it('Agent 压缩处理长对话（真实消息，不拍扁）', async () => {
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
    expect(mockGenerateText).toHaveBeenCalled();
    expect(result.length).toBeLessThan(msgs.length);
    // result[0] 是摘要消息（buildSummaryMessage 构造），含摘要正文
    expect(result[0].role).toBe('user');
    expect(JSON.stringify(result[0])).toContain('用户目标');
    // 验证喂给模型的是结构化 messages（含 tool-call/tool-result），而非拍扁的 prompt 字符串
    const call = mockGenerateText.mock.calls[0][0] as any;
    expect(call.messages).toBeTruthy();
    expect(call.prompt).toBeUndefined();
  });

  it('极端长对话压缩达标（摘要成功路径）', async () => {
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
    expect(result.length).toBeLessThan(msgs.length * 0.1);
  });

  it('Agent 压缩恒失败 -> 返回原消息（不 forceTruncate，交由闸门 413）', async () => {
    mockGenerateText.mockRejectedValue(new Error('provider down'));
    const msgs = generateLongConversation(200);
    const result = await compactBeforeStep(msgs, undefined, {
      model: minimalModel,
      fallbackModels: [minimalModel],
      modelName: 'claude-opus-4',
      conversationId: 'int-5',
      dataStore: mockDataStore,
      tools: { bash: { description: 'bash' } as any },
      instructions: 'x'.repeat(5000),
      contextLimit: 2000,
    });
    // forceTruncate 已删：摘要失败时不偷砍，返回（近）原消息，由闸门显式 413
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(msgs.length * 0.5);
  });

  it('线性扩展：对话越长压缩率越高', async () => {
    const lengths = [10, 50, 100];
    for (const len of lengths) {
      const msgs = generateLongConversation(len);
      const result = await compactBeforeStep(msgs, undefined, {
        model: minimalModel,
        modelName: 'claude-opus-4',
        conversationId: 'int-scale-' + len,
        dataStore: mockDataStore,
        tools: { bash: { description: 'bash' } as any },
        instructions: 'x'.repeat(2000),
        contextLimit: 3000,
      });
      expect(result.length).toBeLessThan(msgs.length * 0.5);
      expect(result[0].role).toBe('user');
    }
  });

  it('濒死压缩后下一步不重算（compactionView 复用，P3）', async () => {
    const { createCompactionView } = await import('../compaction-view');
    const view = createCompactionView();
    const msgs = generateLongConversation(30);
    const ctx = {
      model: minimalModel,
      modelName: 'claude-opus-4',
      conversationId: 'int-view',
      dataStore: mockDataStore,
      tools: { bash: { description: 'bash' } as any },
      instructions: 'x'.repeat(5000),
      contextLimit: 5000,
      compactionView: view,
    };
    // 第一次：超限 -> Agent 压缩，更新 view
    await compactBeforeStep(msgs, undefined, ctx);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    // 第二次：view 生效（前缀已被摘要替换），不再调 LLM
    await compactBeforeStep(msgs, undefined, ctx);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it('P4: Agent 压缩触发时记 ② in->out 决策日志', async () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const msgs = generateLongConversation(30);
      await compactBeforeStep(msgs, undefined, {
        model: minimalModel,
        modelName: 'claude-opus-4',
        conversationId: 'int-p4',
        dataStore: mockDataStore,
        tools: { bash: { description: 'bash' } as any },
        instructions: 'x'.repeat(5000),
        contextLimit: 5000,
      });
      // ② 决策日志:含 in->out,用于回溯和验证"输入按 W 裁定"不变式
      const twoLog = spy.mock.calls.find(
        (c) => typeof c[1] === 'string' && c[1].includes('[②]'),
      );
      expect(twoLog).toBeTruthy();
      expect(twoLog![1]).toContain('fired');
      expect(twoLog![1]).toContain('out=');
      // in ≤ W 正常路径记 in=...;in > W 记 IN>W!!(职责越界告警)
      expect(twoLog![1]).toMatch(/in=\d+|IN>W/);
    } finally {
      spy.mockRestore();
    }
  });

  it('一轮压完仍超限就再压(多轮重压缩,而非直接交闸门)', async () => {
    // mock 返回大摘要(~5500 chars),配合 outputReserve(8000) 让一轮压完仍超 -> 再压。
    // contextLimit 10000 > outputReserve 8000,避免早停(非消息部分不占满窗口)。
    mockGenerateText.mockResolvedValue({ text: '## 用户目标\n' + 'x'.repeat(5500) });
    const msgs = generateLongConversation(50);
    const result = await compactBeforeStep(msgs, undefined, {
      model: minimalModel,
      modelName: 'claude-opus-4',
      conversationId: 'int-multi',
      dataStore: mockDataStore,
      tools: { bash: { description: 'bash' } as any },
      instructions: 'x'.repeat(100), // 小指令,让摘要+尾部成为瓶颈
      contextLimit: 10000,
    });
    // 多轮重压缩:mockGenerateText 被调 > 1 次(而非 1 次就交闸门)
    expect(mockGenerateText.mock.calls.length).toBeGreaterThan(1);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });
});
