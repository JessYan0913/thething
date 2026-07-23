import { describe, it, expect, vi } from 'vitest';
import type { PipelineMessage } from '../../../services/config/compaction-types';
import {
  compressMessagesDeterministic,
  forceTruncateMessages,
} from '../message-compressor';
import { extractMessageText } from '../token-counter';

// ============================================================
// Layer 2.5: 确定性文本压缩测试
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

// 生成辅助测试用的长消息
function longText(n: number): string {
  return 'x'.repeat(n);
}

describe('compressMessagesDeterministic', () => {
  it('返回空列表当输入为空', async () => {
    const result = await compressMessagesDeterministic([], 1000, 'claude-sonnet-4');
    expect(result.messages).toHaveLength(0);
    expect(result.tokensFreed).toBe(0);
  });

  it('无 user 消息时原样返回', async () => {
    const msgs: PipelineMessage[] = [
      assistantMsg('Hello'),
      assistantMsg('World'),
    ];
    const result = await compressMessagesDeterministic(msgs, 1000, 'claude-sonnet-4');
    expect(result.messages).toHaveLength(2);
    expect(result.tokensFreed).toBe(0);
  });

  it('保留首条 user 消息', async () => {
    const msgs: PipelineMessage[] = [
      userMsg('任务目标：请分析项目架构'),
      assistantMsg('分析结果...'),
      toolMsg('grep result: found 10 matches'),
      assistantMsg('继续分析...'),
      assistantMsg('完成分析'),
    ];
    const result = await compressMessagesDeterministic(msgs, 10, 'claude-sonnet-4');
    expect(result.messages[0].role).toBe('user');
    expect((result.messages[0].content as string)).toContain('任务目标');
  });

  it('消息太少时不做压缩', async () => {
    const msgs: PipelineMessage[] = [
      userMsg('任务'),
      assistantMsg('完成'),
    ];
    const result = await compressMessagesDeterministic(msgs, 100, 'claude-sonnet-4');
    expect(result.messagesCompressed).toBe(0);
    expect(result.messages).toHaveLength(2);
  });

  it('中间消息被压缩为摘要', async () => {
    const msgs: PipelineMessage[] = [
      userMsg('任务目标'),
      assistantMsg('第 1 步分析：文件 src/index.ts'),
      toolMsg('Reading src/index.ts...'),
      assistantMsg('第 2 步分析：文件 src/config.ts'),
      toolMsg('Reading src/config.ts...'),
      assistantMsg('第 3 步分析：文件 src/utils.ts'),
      toolMsg('grep result: found patterns'),
      assistantMsg('全部完成'),
    ];
    const result = await compressMessagesDeterministic(msgs, 100, 'claude-sonnet-4');
    // 中间消息应被压缩
    expect(result.messages.length).toBeLessThan(msgs.length);
    // 保留首尾
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[result.messages.length - 1].role).toBe('assistant');
    // 压缩后的摘要消息中存在文件路径信息
    const summaryMsg = result.messages[1];
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg.role).toBe('user');
    const summaryText = extractMessageText(summaryMsg);
    expect(summaryText).toContain('index.ts');
    expect(summaryText).toContain('config.ts');
  });

  it('压缩大量工具调用消息', async () => {
    const msgs: PipelineMessage[] = [
      userMsg('大任务'),
      ...Array(100).fill(null).map((_, i) =>
        toolMsg(`executed command npm run build -- --scope=pkg${i}`)
      ),
      assistantMsg('所有任务完成'),
    ];
    const result = await compressMessagesDeterministic(msgs, 100, 'claude-sonnet-4');
    // 保留首条 user + 摘要 + 尾部(最多 15 条) = 17 条
    expect(result.messages.length).toBeGreaterThan(2);
    expect(result.messages.length).toBeLessThan(30);
    expect(result.tokensFreed).toBeGreaterThan(0);
  });
});

describe('forceTruncateMessages', () => {
  it('空数组返回空', () => {
    const result = forceTruncateMessages([]);
    expect(result).toHaveLength(0);
  });

  it('无 user 消息时保留最后 5 条', () => {
    const msgs: PipelineMessage[] = Array(20).fill(null).map((_, i) =>
      assistantMsg(`msg ${i}`)
    );
    const result = forceTruncateMessages(msgs);
    expect(result).toHaveLength(5);
  });

  it('保留首条 user 消息和尾部消息', () => {
    const msgs: PipelineMessage[] = Array(50).fill(null).map((_, i) => {
      if (i === 0) return userMsg('目标');
      return i % 2 === 0 ? assistantMsg(`step ${i}`) : toolMsg(`tool ${i}`);
    });
    const result = forceTruncateMessages(msgs, 0.15);
    // 首条 + 摘要 + 尾部 ~8 条
    expect(result[0].role).toBe('user');
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThan(msgs.length);
  });
});