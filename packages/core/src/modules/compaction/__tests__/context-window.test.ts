import { describe, it, expect } from 'vitest';
import type { ModelMessage } from 'ai';
import type { UIMessage } from 'ai';
import { validateSummaryQuality } from '../context-window';
import { extractMessageText } from '../token-counter';

// ============================================================
// 步骤 3 验收：中文摘要验证 + 摘要消息格式
// 见 docs/compaction-execution-plan.md 步骤 3
// ============================================================

function userMsg(text: string): ModelMessage {
  return {
    id: `u-${text.slice(0, 8)}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  };
}

describe('validateSummaryQuality (语言无关)', () => {
  const chineseMessages: ModelMessage[] = [
    userMsg('帮我分析一下这个项目的上下文压缩机制有什么问题'),
    userMsg('那 token 统计遗漏的问题怎么修比较好？'),
  ];

  it('accepts a valid Chinese summary (no English keyword dependency)', () => {
    const summary =
      '用户询问了项目上下文压缩机制的问题，助手指出了 extractor 键名不匹配和 token 统计遗漏两处缺陷。' +
      '随后讨论深入到修复方案，助手建议在估算时纳入 text 与 tool-call input，最终确定了分步实施计划。';
    expect(validateSummaryQuality(summary, chineseMessages)).toBe(true);
  });

  it('rejects a too-short summary', () => {
    expect(validateSummaryQuality('好的。', chineseMessages)).toBe(false);
  });

  it('rejects a summary that is mostly copied from the original', () => {
    // 摘要几乎全文复制第一条用户消息 → LCS 占比过高
    const copied = '帮我分析一下这个项目的上下文压缩机制有什么问题';
    expect(validateSummaryQuality(copied, chineseMessages)).toBe(false);
  });

  it('accepts an English summary as well (language-agnostic)', () => {
    const enMessages = [userMsg('Please review the compaction module for bugs')];
    const summary =
      'The user asked for a review of the compaction module. The assistant identified two defects: ' +
      'mismatched extractor keys and missing token accounting, then proposed a staged fix plan.';
    expect(validateSummaryQuality(summary, enMessages)).toBe(true);
  });

  // 8.4:结构化任务状态摘要(8-section 风格)应通过验证
  it('accepts a structured task-state summary with section headers', () => {
    const summary = [
      '## 用户目标 / 验收标准',
      '修复上下文压缩机制的若干缺陷，验收标准是既有测试不回归。',
      '## 已完成步骤 & 关键结论',
      '- 统一了 token 估算系数并加入 CJK 校准',
      '- 实现了 usage 反馈校准，EMA 夹在 [0.5, 2]',
      '## 涉及的文件路径及改动',
      '- packages/core/src/primitives/token-estimate.ts：新增统一估算模块',
      '## 当前卡点 / 下一步计划',
      '正在实现结构化任务状态摘要，下一步做 checkpoint 持久化。',
      '## 用户明确表达的约束与偏好',
      '用中文回复；不重构无关代码。',
    ].join('\n');
    expect(validateSummaryQuality(summary, chineseMessages)).toBe(true);
  });
});

describe('summaryMessage 格式 (.content 而非 .parts)', () => {
  it('a .content-format summary message serializes to non-empty model text', () => {
    // enforceContextWindow 生成的 summaryMessage 使用 ModelMessage .content 格式,
    // 流水线序列化时应能提取出非空文本(修复前 .parts 格式被序列化为空消息)
    const summaryMessage = {
      id: 'summary-1',
      role: 'user',
      content: [{ type: 'text', text: 'This session is being continued.\n\n摘要内容' }],
    } as unknown as ModelMessage;

    const text = extractMessageText(summaryMessage);
    expect(text).toContain('摘要内容');
    expect(text.length).toBeGreaterThan(0);
  });
});
