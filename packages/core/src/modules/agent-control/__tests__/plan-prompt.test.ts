import { describe, it, expect } from 'vitest';
import { buildPlanPrompt, buildEmptyTodoReminder } from '../plan-prompt';

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
