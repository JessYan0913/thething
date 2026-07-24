// ============================================================
// CompactionView 集成测试
// ============================================================
// 验证视图机制是否正确工作

import { describe, it, expect, beforeEach } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  createCompactionView,
  applyCompactionView,
  updateViewAfterL3,
  fingerprintMessage,
} from '../compaction-view';

describe('CompactionView Integration', () => {
  let view: ReturnType<typeof createCompactionView>;

  beforeEach(() => {
    view = createCompactionView();
  });

  it('should apply view when summary exists and fingerprint matches', () => {
    // 模拟原始消息
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Task 1' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'Task 2' },
      { role: 'assistant', content: 'Response 2' },
      { role: 'user', content: 'Task 3' },
    ];

    // 模拟 Layer 3 生成摘要，覆盖前 3 条消息
    const summaryMessage: ModelMessage = {
      role: 'assistant',
      content: 'Summary of tasks 1-2',
    };
    const anchorIndex = 2; // 覆盖到第 2 条（Task 2）
    const anchorMessage = messages[anchorIndex];

    // 更新视图
    updateViewAfterL3(view, summaryMessage, anchorIndex, anchorMessage, 'Summary of tasks 1-2');

    // 模拟下一步：prepareStep 收到更多消息
    const nextStepMessages: ModelMessage[] = [
      ...messages,
      { role: 'assistant', content: 'Response 3' },
    ];

    // 应用视图
    const result = applyCompactionView(nextStepMessages, view);

    expect(result.applied).toBe(true);
    expect(result.messages).toHaveLength(4); // summary + 后 3 条
    expect(result.messages[0]).toEqual(summaryMessage);
    expect(result.messages[1]).toEqual(messages[3]);
  });

  it('should not apply view when fingerprint mismatches', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Task 1' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'Task 2' },
    ];

    const summaryMessage: ModelMessage = {
      role: 'assistant',
      content: 'Summary',
    };
    const anchorIndex = 1;

    // 更新视图
    updateViewAfterL3(view, summaryMessage, anchorIndex, messages[anchorIndex], 'Summary');

    // 模拟历史被修改（内容变化）
    const modifiedMessages: ModelMessage[] = [
      messages[0],
      { role: 'assistant', content: 'MODIFIED Response 1' }, // 内容改变
      messages[2],
    ];

    // 应用视图
    const result = applyCompactionView(modifiedMessages, view);

    expect(result.applied).toBe(false); // 指纹不匹配，视图失效
    expect(result.messages).toEqual(modifiedMessages);
    expect(view.summary).toBeNull(); // 视图被清空
  });

  it('should handle no summary case', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Task 1' },
      { role: 'assistant', content: 'Response 1' },
    ];

    const result = applyCompactionView(messages, view);

    expect(result.applied).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it('should calculate fingerprint consistently', () => {
    const message: ModelMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        {
          type: 'tool-call',
          toolCallId: 'call-123',
          toolName: 'test-tool',
          input: { arg: 'value' },
        },
      ],
    };

    const fp1 = fingerprintMessage(message);
    const fp2 = fingerprintMessage(message);

    expect(fp1).toBe(fp2);
    expect(fp1).toContain('assistant');
    expect(fp1).toContain('call-123');
  });

  it('should handle tool-result in fingerprint', () => {
    const message: ModelMessage = {
      role: 'assistant',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-456',
          toolName: 'test-tool',
          output: { type: 'text', value: 'some result' },
        },
      ],
    };

    const fp = fingerprintMessage(message);

    expect(fp).toContain('call-456');
    // result 内容不包含在指纹中（因为可能被 Layer 2 压缩）
  });
});

describe('CompactionView - End to End', () => {
  it('should work across multiple steps', () => {
    const view = createCompactionView();

    // Step 1: 初始消息
    const step1Messages: ModelMessage[] = [
      { role: 'user', content: 'Task 1' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'Task 2' },
      { role: 'assistant', content: 'Response 2' },
      { role: 'user', content: 'Task 3' },
      { role: 'assistant', content: 'Response 3' },
    ];

    // Layer 3 触发：生成摘要
    const summaryMessage: ModelMessage = {
      role: 'assistant',
      content: 'Summary of first 4 messages',
    };
    const anchorIndex = 3; // 覆盖前 4 条

    updateViewAfterL3(
      view,
      summaryMessage,
      anchorIndex,
      step1Messages[anchorIndex],
      'Summary of first 4 messages',
    );

    // Step 2: prepareStep 收到完整历史 + 新消息
    const step2Messages: ModelMessage[] = [
      ...step1Messages,
      { role: 'user', content: 'Task 4' },
    ];

    const step2Result = applyCompactionView(step2Messages, view);

    expect(step2Result.applied).toBe(true);
    expect(step2Result.messages).toHaveLength(4); // summary + 后 3 条
    expect(step2Result.messages[0].content).toBe('Summary of first 4 messages');

    // Step 3: 再次收到更多消息
    const step3Messages: ModelMessage[] = [
      ...step2Messages,
      { role: 'assistant', content: 'Response 4' },
    ];

    const step3Result = applyCompactionView(step3Messages, view);

    expect(step3Result.applied).toBe(true);
    expect(step3Result.messages).toHaveLength(5); // summary + 后 4 条
  });

  it('should clear view when anchor not found', () => {
    const view = createCompactionView();

    const messages: ModelMessage[] = [
      { role: 'user', content: 'Task 1' },
      { role: 'assistant', content: 'Response 1' },
    ];

    const summaryMessage: ModelMessage = {
      role: 'assistant',
      content: 'Summary',
    };

    updateViewAfterL3(view, summaryMessage, 10, messages[0], 'Summary'); // anchorIndex 超出范围

    const result = applyCompactionView(messages, view);

    expect(result.applied).toBe(false);
    expect(view.summary).toBeNull();
  });
});
