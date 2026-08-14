import { describe, it, expect } from 'vitest';
import {
  isTrivialRequest,
  getLastUserText,
  buildPlanPrompt,
  buildEmptyTodoReminder,
} from '../multi-step-detector';

describe('isTrivialRequest（噪音控制，仅跳过超短请求）', () => {
  it('超短请求跳过提示', () => {
    expect(isTrivialRequest('现在几点')).toBe(true);
    expect(isTrivialRequest('帮我写一封请假邮件')).toBe(true);
    expect(isTrivialRequest('谢谢')).toBe(true);
  });

  it('正常长度请求不跳过（交给模型判断是否多步）', () => {
    expect(isTrivialRequest('帮我规划一次三天两夜的北京周末游')).toBe(false);
    expect(isTrivialRequest('写一个工具函数并配上单测')).toBe(false);
    expect(isTrivialRequest('把这句话翻译成英文，再解释一下语法')).toBe(false);
  });

  it('空白处理', () => {
    expect(isTrivialRequest('  ')).toBe(true);
    expect(isTrivialRequest('')).toBe(true);
  });
});

describe('getLastUserText', () => {
  it('从纯文本 user 消息提取', () => {
    const msgs = [{ role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: '帮我做三件事' }];
    expect(getLastUserText(msgs)).toBe('帮我做三件事');
  });

  it('从多部分 user 消息提取文本', () => {
    const msgs = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: '帮我' },
          { type: 'text' as const, text: '做两件事' },
        ],
      },
    ];
    expect(getLastUserText(msgs)).toBe('帮我 做两件事');
  });

  it('跳过 tool-result 部分，非 user 消息返回空串', () => {
    const msgs = [{ role: 'assistant' as const, content: '回答' }];
    expect(getLastUserText(msgs)).toBe('');
  });
});

describe('注入消息', () => {
  it('开工提示与兜底提醒都包含"先建清单"意图，且把判断交给模型', () => {
    const prompt = buildPlanPrompt();
    expect(prompt).toContain('todo_write');
    expect(prompt).toContain('直接回答');

    const reminder = buildEmptyTodoReminder();
    expect(reminder).toContain('todo_write');
    expect(reminder).toContain('确认是单步任务');
  });
});
