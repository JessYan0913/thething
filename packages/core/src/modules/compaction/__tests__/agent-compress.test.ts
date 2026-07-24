import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { agentCompress } from '../agent-compress';

// ============================================================
// agentCompress - 统一 Agent 驱动压缩器单元测试（P2）
// 主模型读真实 ModelMessage(不拍扁、不 slice),restoreMissingPaths 确定性保真。
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
  '## 用户目标\n下载视频\n## 已完成步骤\n分析了仓库\n## 涉及的文件\nsrc/index.ts\n## 当前状态\n继续';

function userMsg(text: string): ModelMessage {
  return { role: 'user', content: text } as ModelMessage;
}
function assistantMsg(text: string): ModelMessage {
  return { role: 'assistant', content: text } as ModelMessage;
}

const mockModel = {
  specificationVersion: 'v1',
  provider: 'test',
  modelId: 'claude-opus-4',
  defaultObjectGenerationMode: 'json',
  supportsUrl: vi.fn(),
  doGenerate: vi.fn(),
} as any;

function makeDataStore(existingSummary: string | null = null, saveSpy = vi.fn()) {
  return {
    summaryStore: {
      getSummaryByConversation: () => (existingSummary ? { summary: existingSummary } : null),
      saveSummary: saveSpy,
    },
  } as any;
}

function longOlder(): ModelMessage[] {
  return [
    userMsg('任务目标：重构模块 A'),
    ...Array(10).fill(null).map((_, i) => assistantMsg(`第 ${i} 步分析结果 ${'内容'.repeat(20)}`)),
  ];
}

describe('agentCompress', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ text: SUMMARY_TEXT });
  });

  it('成功生成摘要并返回 summaryMessage', async () => {
    const result = await agentCompress(longOlder(), {
      model: mockModel,
      modelName: 'claude-opus-4',
      conversationId: 'c1',
      dataStore: makeDataStore(),
    });
    expect(result.success).toBe(true);
    expect(result.summaryText).toBeTruthy();
    expect(result.summaryMessage).toBeTruthy();
    expect(result.summaryMessage!.role).toBe('user');
  });

  it('喂真实结构化 messages（不拍扁为 prompt 字符串）', async () => {
    const msgs = longOlder();
    await agentCompress(msgs, {
      model: mockModel,
      modelName: 'claude-opus-4',
      conversationId: 'c2',
      dataStore: makeDataStore(),
    });
    const call = mockGenerateText.mock.calls[0][0] as any;
    // 用 messages 参数传结构化消息，而非 prompt 拍扁
    expect(Array.isArray(call.messages)).toBe(true);
    expect(call.messages.length).toBe(msgs.length);
    expect(call.prompt).toBeUndefined();
  });

  it('LLM 恒失败 -> success=false（不 forceTruncate，交由闸门）', async () => {
    mockGenerateText.mockRejectedValue(new Error('provider down'));
    const result = await agentCompress(longOlder(), {
      model: mockModel,
      fallbackModels: [mockModel],
      modelName: 'claude-opus-4',
      conversationId: 'c3',
      dataStore: makeDataStore(),
    });
    expect(result.success).toBe(false);
    expect(result.summaryMessage).toBeUndefined();
  });

  it('tool-result 找回路径被确定性补回（模型丢失也兜底）', async () => {
    // 模型摘要完全没保留路径（违反提示词约束）
    mockGenerateText.mockResolvedValue({
      text: '## 用户目标\n下载视频\n## 已完成步骤\n分析了仓库\n## 当前状态\n继续',
    });
    const fullPath = '/Users/yanheng/.thething/data/tool-results/A5j5lHn/call-5360692c.json';
    const msgs: ModelMessage[] = [
      userMsg('任务目标'),
      assistantMsg('执行了 grep,结果很大'),
      assistantMsg(`Grep 'pattern' -> 10 matches\n[Full output saved to: ${fullPath}]\n[To recover: use read_file]`),
      ...Array(8).fill(null).map((_, i) => assistantMsg(`后续 ${i}`)),
    ];
    const result = await agentCompress(msgs, {
      model: mockModel,
      modelName: 'claude-opus-4',
      conversationId: 'c4',
      dataStore: makeDataStore(),
    });
    expect(result.success).toBe(true);
    expect(result.summaryText).toContain(fullPath);
    expect(result.summaryText).toContain('## 可找回的工具输出');
  });

  it('增量：已有摘要作为【历史摘要】前置喂给模型', async () => {
    const existing = '## 用户目标\n旧目标\n## 已完成步骤\n旧步骤';
    await agentCompress(longOlder(), {
      model: mockModel,
      modelName: 'claude-opus-4',
      conversationId: 'c5',
      dataStore: makeDataStore(existing),
    });
    const call = mockGenerateText.mock.calls[0][0] as any;
    // 第一条 messages 是【历史摘要】前置
    const first = call.messages[0];
    expect(first.role).toBe('user');
    expect(first.content).toContain('【历史摘要】');
    expect(first.content).toContain('旧目标');
  });

  it('提供 anchorMessageId 时落库', async () => {
    const saveSpy = vi.fn();
    await agentCompress(longOlder(), {
      model: mockModel,
      modelName: 'claude-opus-4',
      conversationId: 'c6',
      dataStore: makeDataStore(null, saveSpy),
      anchorMessageId: 'msg-anchor-1',
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const args = saveSpy.mock.calls[0];
    expect(args[0]).toBe('c6'); // conversationId
    expect(args[4]).toBe('msg-anchor-1'); // anchorMessageId
  });

  it('不提供 anchorMessageId 时不落库（Path B 在 P2 仅更新视图）', async () => {
    const saveSpy = vi.fn();
    await agentCompress(longOlder(), {
      model: mockModel,
      modelName: 'claude-opus-4',
      conversationId: 'c7',
      dataStore: makeDataStore(null, saveSpy),
      // 无 anchorMessageId
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
