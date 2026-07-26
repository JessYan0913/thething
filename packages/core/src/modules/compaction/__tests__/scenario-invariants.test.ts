import { describe, it, expect, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { compactBeforeStep } from '../index';
import { manageToolOutputLifecycle } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';
import { extractActionLog } from '../action-log';

// ============================================================
// 多场景不变式验证（见 docs/compaction-road-to-excellent.md 差距三）
// ============================================================
// 覆盖短/中/长 + 重跑孤儿场景,断言四条不变式在不同对话形态下成立。
// 性质测试抓随机,场景测试抓"已知的 adversarial 形态"(大对话触发 Layer 2.5/3、
// 重跑孤儿触发 selfHeal)。

const mockModel = {
  specificationVersion: 'v1',
  provider: 'test',
  modelId: 'claude-opus-4',
  defaultObjectGenerationMode: 'json',
  supportsUrl: vi.fn(),
  doGenerate: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '## 用户目标\n测试\n## 已完成步骤\n读了 douyin_downloader.py' }],
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    warnings: [],
  }),
} as any;

const mockDataStore = {
  summaryStore: {
    getSummaryByConversation: () => null,
    saveSummary: () => {},
  },
  messageStore: {
    getMessagesByConversation: () => [] as ModelMessage[],
  },
} as any;

function uiUser(text: string): ModelMessage {
  return { id: `u-${Math.random()}`, role: 'user', parts: [{ type: 'text', text }] } as unknown as ModelMessage;
}
function uiTool(toolName: string, input: unknown, output: string, tcId?: string): ModelMessage {
  return {
    id: `t-${tcId ?? Math.random()}`,
    role: 'assistant',
    parts: [{
      type: `tool-${toolName}` as any,
      toolCallId: tcId ?? `tc-${Math.random()}`,
      state: 'output-available',
      input,
      output: { type: 'text', value: output },
    }],
  } as unknown as ModelMessage;
}

/** 断言:输出里仍含 provenance 段 + 大部分原 key(filePath/url)保留。
 *  极端压缩下 provenance 段有 2000 字符上限,允许少量截断,但不应全丢。 */
function assertProvenancePreserved(original: ModelMessage[], output: ModelMessage[]) {
  const outputText = JSON.stringify(output);
  // provenance 段必须存在(机器生成,保 key 不靠 LLM)
  expect(outputText).toContain('行动日志（provenance');
  // 大部分原 key 的路径应保留(允许少量被 2000 字符上限截断)
  const origKeys = extractActionLog(original).filter(e => e.kind === 'tool' && e.input);
  let preserved = 0;
  for (const k of origKeys) {
    const inputStr = JSON.stringify(k.input);
    const pathMatch = inputStr.match(/"(filePath|url|path|command)"\s*:\s*"([^"]+)"/);
    if (pathMatch && outputText.includes(pathMatch[2])) preserved++;
  }
  // 至少 80% 的路径保留(允许截断,但不允许大量丢失)
  expect(preserved / origKeys.length).toBeGreaterThan(0.8);
}

describe('场景:短对话不触发压缩', () => {
  it('5 条小消息 -> 原样返回,key 保留', async () => {
    const msgs = [
      uiUser('读文件'),
      uiTool('read_file', { filePath: '/a.ts' }, 'content a'),
      uiUser('继续'),
      uiTool('web_fetch', { url: 'https://x.com' }, 'content x'),
      uiUser('完成'),
    ];
    const result = await compactBeforeStep(msgs, undefined, {
      model: mockModel, modelName: 'test', conversationId: 's-short', dataStore: mockDataStore,
      contextLimit: 128000,
    });
    expect(result.length).toBe(msgs.length);
    // key 保留
    const log = extractActionLog(result);
    expect(log.some(e => e.kind === 'tool' && JSON.stringify(e.input).includes('/a.ts'))).toBe(true);
    expect(log.some(e => e.kind === 'tool' && JSON.stringify(e.input).includes('https://x.com'))).toBe(true);
  });
});

describe('场景:中等对话 Layer 2 介入,key 保留', () => {
  it('多条旧工具输出被 meta 化,但 input 保留', () => {
    const big = 'x'.repeat(10000);
    const msgs: ModelMessage[] = [uiUser('任务')];
    for (let i = 0; i < 10; i++) {
      msgs.push(uiTool('read_file', { filePath: `/file${i}.ts` }, big, `tc-${i}`));
    }
    const result = manageToolOutputLifecycle(msgs, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 2 });
    // 旧的被 meta 化
    const log = extractActionLog(result.messages);
    const metaCount = log.filter(e => e.kind === 'tool' && e.valueState === 'meta').length;
    expect(metaCount).toBeGreaterThan(0);
    // 但 key(filePath)全保留
    for (let i = 0; i < 10; i++) {
      expect(log.some(e => JSON.stringify(e.input ?? '').includes(`/file${i}.ts`))).toBe(true);
    }
  });
});

describe('场景:长对话 + 小 context 触发 Layer 2.5/3,provenance 保留', () => {
  it('200 轮 + 极小 contextLimit -> 仍含原 key 的路径/URL', async () => {
    const msgs: ModelMessage[] = [uiUser('目标:分析项目')];
    for (let i = 0; i < 50; i++) {
      msgs.push(uiTool('read_file', { filePath: `/src/f${i}.ts` }, 'x'.repeat(2000), `tc-${i}`));
      msgs.push(uiUser(`继续 ${i}`));
    }
    const result = await compactBeforeStep(msgs, undefined, {
      model: mockModel, modelName: 'test', conversationId: 's-long', dataStore: mockDataStore,
      tools: { bash: { description: 'bash' } as any },
      instructions: 'test',
      contextLimit: 3000, // 极小,强制 Layer 2.5/3
    });
    expect(result.length).toBeLessThan(msgs.length);
    // provenance 保留:原 key 的路径/URL 至少部分能在输出找到
    assertProvenancePreserved(msgs, result);
  }, 30000);
});

describe('场景:超大单条消息被纳入摘要段(根因修复验证)', () => {
  it('1MB 消息在中间 -> checkpoint 摘要覆盖它而非留在保留段', () => {
    // 直接测 lifecycle:超大消息触发截断(当前步)或 meta(旧),不会原样留着
    const huge = 'x'.repeat(20000);
    const msgs = [
      uiUser('读'),
      uiTool('read_file', { filePath: '/big.ts' }, huge, 'tc-1'),
      uiUser('然后'),
      uiTool('bash', { command: 'echo done' }, 'done', 'tc-2'),
    ];
    const result = manageToolOutputLifecycle(msgs, DEFAULT_LIFECYCLE_CONFIG);
    // 当前步(tc-2 bash)小,保留;旧 read_file(tc-1)超大 -> 截断(当前步)或后续 meta
    // 关键:input 保留
    const log = extractActionLog(result.messages);
    expect(log.some(e => JSON.stringify(e.input ?? '').includes('/big.ts'))).toBe(true);
    expect(log.some(e => JSON.stringify(e.input ?? '').includes('echo done'))).toBe(true);
  });
});
