import { describe, it, expect } from 'vitest';
import { buildPlanPrompt, buildTodoSyncReminder, buildEmptyTodoReminder } from '../plan-prompt';

describe('注入消息', () => {
  it('开工提示与兜底提醒都以"心智复杂度"而非"步骤数"为判断依据', () => {
    const prompt = buildPlanPrompt();
    expect(prompt).toContain('todo_write');
    expect(prompt).toContain('直接回答');
    expect(prompt).toContain('拆成几个子问题'); // 复杂度 = 拆解
    expect(prompt).toContain('即使实际步骤不多'); // 明确不按步骤数判断

    const reminder = buildEmptyTodoReminder();
    expect(reminder).toContain('todo_write');
    expect(reminder).toContain('确认简单直接');
  });

  it('开工提示包含"收尾结清"契约（建了就要跟进，不是开工宣言）', () => {
    const prompt = buildPlanPrompt();
    expect(prompt).toContain('结清');
    expect(prompt).toContain('completed');
    expect(prompt).toContain('【进度汇报】'); // 明确不机械汇报
  });

  it('开工提示包含并行执行决策引导（B12：分支判断交 LLM，不预设 if-then）', () => {
    const prompt = buildPlanPrompt();
    expect(prompt).toContain('parallel_agent');
    expect(prompt).toContain('agent 工具');
    expect(prompt).toContain('自主判断'); // 并行/串行由 LLM 自行判断，不预设定死分支
  });

  it('每步同步提醒：督促建后持续更新，且不诱导滚动窗口、不机械汇报', () => {
    const sync = buildTodoSyncReminder();
    expect(sync).toContain('todo_write');
    expect(sync).toContain('result');
    expect(sync).toContain('未列出的待办会被保留'); // 传子集不丢项
    expect(sync).toContain('不要插入【进度汇报】'); // 不机械汇报
  });
});
