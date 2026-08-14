import { describe, it, expect } from 'vitest';
import {
  looksMultiStep,
  executionIntent,
  workedWithoutPlanning,
  getLastUserText,
  buildPlanFirstInjection,
  buildStrictPlanFirstInjection,
  buildEmptyTodoReminder,
} from '../multi-step-detector';

// 与 scripts/todo-baseline/cases.ts 的 12 条基线请求保持一致（预期值已由 Phase 0 实测确认）
const BASELINE: Array<{ id: string; expectMultiStep: boolean; request: string }> = [
  // 编码域多步（实测建单率 3/3、1/3）→ 应判多步
  {
    id: 'c01',
    expectMultiStep: true,
    request:
      '写一个 TypeScript 工具函数 parseCsv（要正确处理引号转义和字段内换行），放到 src/utils/parse-csv.ts，并为它写 vitest 单测，覆盖正常输入、含引号字段、空行三个边界情况，然后尝试运行测试验证结果。',
  },
  {
    id: 'c02',
    expectMultiStep: true,
    request:
      '重构 src/utils/store.ts：把类里的 getItems 和 addItem 两个方法拆到独立的文件 src/utils/store-queries.ts，保持对外行为完全不变，并更新 store.ts 里的引用。',
  },
  // 非编码域多步（实测建单率 3/4、1/7）→ 应判多步
  {
    id: 'g01',
    expectMultiStep: true,
    request: '帮我规划一次三天两夜的北京周末游：给出每天的行程安排、总预算估算、和一份行李清单。',
  },
  {
    id: 'g02',
    expectMultiStep: true,
    request: '整理一下我最近要处理的事情：列出最重要的五件事，按优先级排序，标注哪些可以合并处理，最后给我一页简洁的总结。',
  },
  {
    id: 'g03',
    expectMultiStep: true,
    request: '我要写一篇公众号文章介绍生成式 AI，帮我完成三件事：列一个大纲、写一份初稿、再想三个吸引人的标题。',
  },
  {
    id: 'g04',
    expectMultiStep: true,
    request: '帮我研究一下「远程办公」的现状和发展趋势，写一份简短的调研报告，并列出几个值得关注的公司。',
  },
  // 单步/纯问答 → 不应判多步
  { id: 's01', expectMultiStep: false, request: '2 的 10 次方是多少？' },
  { id: 's02', expectMultiStep: false, request: '把这句话翻译成英文：今天天气真不错' },
  { id: 's03', expectMultiStep: false, request: '什么是依赖注入？用一句话解释一下' },
  // 边界模糊（实测均未建单）→ 倾向不判多步
  { id: 'a01', expectMultiStep: false, request: '帮我写一封请假邮件' },
  { id: 'a02', expectMultiStep: false, request: '比较一下 iPhone 和 Android 的优缺点，给我一个购买建议' },
  { id: 'a03', expectMultiStep: false, request: '帮我查一下明天北京的天气' },
];

describe('looksMultiStep', () => {
  it('12 条基线请求的分类与实测行为一致', () => {
    for (const c of BASELINE) {
      expect(looksMultiStep(c.request), `${c.id} 应判 ${c.expectMultiStep ? '多步' : '非多步'}`).toBe(
        c.expectMultiStep,
      );
    }
  });

  it('其它典型多步请求（含非编码域）能识别', () => {
    const multi = [
      '帮我安排明天的会议，发一封邀请邮件，再订一间会议室',
      '写一篇博客文章并发布到公众号',
      '先整理桌面上的文件，然后按类型归档，最后生成一份清单',
      '帮我准备三份营销方案，并比较它们的优劣',
      '调研一下竞品定价，写份对比报告，再给出建议',
    ];
    for (const r of multi) expect(looksMultiStep(r), `应判多步: ${r}`).toBe(true);
  });

  it('典型单步请求不误判', () => {
    const single = [
      '现在几点',
      '帮我订一份外卖',
      '把"hello"翻译成法语',
      '推荐一首歌',
      '天气如何',
    ];
    for (const r of single) expect(looksMultiStep(r), `不应判多步: ${r}`).toBe(false);
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

describe('executionIntent', () => {
  it('执行型请求（改代码/文件/外部系统）被识别', () => {
    const exec = [
      '写一个 TypeScript 工具函数 parseCsv（要正确处理引号转义和字段内换行），放到 src/utils/parse-csv.ts，并为它写 vitest 单测，覆盖正常输入、含引号字段、空行三个边界情况，然后尝试运行测试验证结果。',
      '重构 src/utils/store.ts：把类里的 getItems 和 addItem 两个方法拆到独立的文件 src/utils/store-queries.ts，保持对外行为完全不变，并更新 store.ts 里的引用。',
      '帮我研究一下「远程办公」的现状和发展趋势，写一份简短的调研报告，并列出几个值得关注的公司。',
    ];
    for (const r of exec) expect(executionIntent(r), `应判执行型: ${r}`).toBe(true);
  });

  it('内容型请求（输出即答案）不被误判为执行型', () => {
    const content = [
      '我要写一篇公众号文章介绍生成式 AI，帮我完成三件事：列一个大纲、写一份初稿、再想三个吸引人的标题。',
      '帮我规划一次三天两夜的北京周末游：给出每天的行程安排、总预算估算、和一份行李清单。',
      '整理一下我最近要处理的事情：列出最重要的五件事，按优先级排序，标注哪些可以合并处理，最后给我一页简洁的总结。',
      '什么是依赖注入？用一句话解释一下',
    ];
    for (const r of content) expect(executionIntent(r), `不应判执行型: ${r}`).toBe(false);
  });
});

describe('workedWithoutPlanning', () => {
  it('上一步调用了非 todo 工具 → true', () => {
    expect(workedWithoutPlanning({ toolCalls: [{ name: 'read_file' }] })).toBe(true);
  });

  it('上一步调用了 todo 工具 → false', () => {
    expect(workedWithoutPlanning({ toolCalls: [{ name: 'todo_write' }] })).toBe(false);
    expect(workedWithoutPlanning({ toolCalls: [{ name: 'todo_write' }, { name: 'read_file' }] })).toBe(false);
  });

  it('上一步无工具调用 → false', () => {
    expect(workedWithoutPlanning({ toolCalls: [] })).toBe(false);
    expect(workedWithoutPlanning(undefined)).toBe(false);
  });

  it('兼容 toolName 字段', () => {
    expect(workedWithoutPlanning({ toolCalls: [{ toolName: 'read_file' }] })).toBe(true);
    expect(workedWithoutPlanning({ toolCalls: [{ toolName: 'todo_list' }] })).toBe(false);
  });
});

describe('注入消息', () => {
  it('首轮注入与兜底提醒都包含"先建清单"意图', () => {
    expect(buildPlanFirstInjection()).toContain('todo_write');
    expect(buildEmptyTodoReminder()).toContain('todo_write');
  });

  it('执行型硬注入不含"可直接回答"出口，且明确要求先建清单', () => {
    const strict = buildStrictPlanFirstInjection();
    expect(strict).toContain('todo_write');
    expect(strict).not.toContain('可直接回答');
    expect(strict).toContain('必须');
  });
});
