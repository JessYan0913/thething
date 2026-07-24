import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { checkInitialBudget } from '../budget-check';

// ============================================================
// 场景 1 集成测试:打开一个积攒多日、远超窗口、且没有 checkpoint 的旧对话
// 入口 = checkInitialBudget(createAgent 打开会话时的真实路径)
// 期望:分块折叠压缩把任意大的冷对话压进窗口 -> passed=true,
//       且首次压缩即落库(下次打开 applyCheckpointOnLoad 直接命中,秒开)
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

/** 带 .id 的消息(DB 加载出的消息都有 id,锚点/落库依赖它) */
function msgWithId(id: string, role: 'user' | 'assistant', text: string): ModelMessage {
  return { id, role, content: text } as unknown as ModelMessage;
}

const minimalModel = {
  specificationVersion: 'v3',
  provider: 'test',
  modelId: 'claude-opus-4',
  supportedUrls: {},
  doGenerate: vi.fn(),
  doStream: vi.fn(),
} as any;

describe('场景1:冷加载超大旧对话(无 checkpoint)', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ text: SUMMARY_TEXT });
  });

  it('总量 2 倍于窗口的冷对话:分块压缩通过,首次压缩即落库', async () => {
    // contextLimit 30000;对话 ~60000 tokens(2W),无 checkpoint
    const msgs: ModelMessage[] = [msgWithId('m0', 'user', '任务目标:分析整个项目')];
    for (let i = 0; i < 120; i++) {
      msgs.push(msgWithId(`m${i + 1}`, 'assistant', `分析 ${i}: ` + '结论内容'.repeat(120))); // ~500 tok/条
    }

    const saveSpy = vi.fn();
    const mockDataStore = {
      summaryStore: {
        getSummaryByConversation: () => null, // 无 checkpoint(冷)
        saveSummary: saveSpy,
      },
    } as any;

    const result = await checkInitialBudget(
      msgs,
      'instructions',
      { bash: { description: 'bash' } as any },
      'claude-opus-4',
      undefined,
      {
        dataStore: mockDataStore,
        conversationId: 'cold-huge',
        model: minimalModel,
        contextLimit: 30000,
      },
    );

    // 1. 能通过(不再 413 卡死)
    expect(result.passed).toBe(true);
    // 2. 走了分块折叠(待压段 ~2W > 单块预算 0.6W,必然多块)
    expect(mockGenerateText.mock.calls.length).toBeGreaterThan(1);
    // 3. 每块输入有界:没有任何一次调用把全部 121 条塞进去
    for (const call of mockGenerateText.mock.calls) {
      const messages = (call[0] as any).messages as unknown[];
      expect(messages.length).toBeLessThan(msgs.length);
    }
    // 4. 首次压缩即落库(DB 消息有 .id -> 锚点可用),下次打开命中 checkpoint 秒开
    expect(saveSpy).toHaveBeenCalled();
    // 5. 压缩后的消息集显著变小
    expect(result.adjustedMessages).toBeDefined();
    expect(result.adjustedMessages!.length).toBeLessThan(msgs.length * 0.5);
  });
});
