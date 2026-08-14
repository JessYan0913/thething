// ============================================================
// Todo Baseline 固定请求集 (Phase 0)
// ============================================================
// 目标：在真实 agent 上复现"建 todo 不稳定"症状，量化基线。
// 四类请求：
//   multi-code    —— 编码域多步（当前触发词汇的"甜区"，应触发）
//   multi-general —— 非编码域多步（个人助手日常，触发词汇错配区）
//   single        —— 单步/纯问答（不应触发）
//   ambiguous     —— 边界模糊（最可能不稳定）
//
// 注意：multi-code 用例引用的路径都应在沙箱 cwd 内（run.ts 会播种）。

export type CaseCategory = 'multi-code' | 'multi-general' | 'single' | 'ambiguous';

export interface BaselineCase {
  id: string;
  category: CaseCategory;
  label: string;
  /** 预期：该请求是否"应该"建 todo（用于评估命中率） */
  expectTodo: boolean;
  request: string;
}

export const CASES: BaselineCase[] = [
  // ── 编码域多步（当前触发词汇的甜区）────────────────────────────
  {
    id: 'c01',
    category: 'multi-code',
    label: '写函数+单测+运行',
    expectTodo: true,
    request:
      '写一个 TypeScript 工具函数 parseCsv（要正确处理引号转义和字段内换行），放到 src/utils/parse-csv.ts，' +
      '并为它写 vitest 单测，覆盖正常输入、含引号字段、空行三个边界情况，然后尝试运行测试验证结果。',
  },
  {
    id: 'c02',
    category: 'multi-code',
    label: '重构拆文件+保持行为',
    expectTodo: true,
    request:
      '重构 src/utils/store.ts：把类里的 getItems 和 addItem 两个方法拆到独立的文件 src/utils/store-queries.ts，' +
      '保持对外行为完全不变，并更新 store.ts 里的引用。',
  },
  // ── 非编码域多步（触发词汇错配区）──────────────────────────────
  {
    id: 'g01',
    category: 'multi-general',
    label: '规划行程+预算+清单',
    expectTodo: true,
    request:
      '帮我规划一次三天两夜的北京周末游：给出每天的行程安排、总预算估算、和一份行李清单。',
  },
  {
    id: 'g02',
    category: 'multi-general',
    label: '整理待办+排序+合并',
    expectTodo: true,
    request:
      '整理一下我最近要处理的事情：列出最重要的五件事，按优先级排序，标注哪些可以合并处理，最后给我一页简洁的总结。',
  },
  {
    id: 'g03',
    category: 'multi-general',
    label: '公众号文章：大纲+初稿+标题',
    expectTodo: true,
    request:
      '我要写一篇公众号文章介绍生成式 AI，帮我完成三件事：列一个大纲、写一份初稿、再想三个吸引人的标题。',
  },
  {
    id: 'g04',
    category: 'multi-general',
    label: '调研+报告+公司清单',
    expectTodo: true,
    request:
      '帮我研究一下「远程办公」的现状和发展趋势，写一份简短的调研报告，并列出几个值得关注的公司。',
  },
  // ── 单步 / 纯问答（不应建 todo）────────────────────────────────
  {
    id: 's01',
    category: 'single',
    label: '纯计算问答',
    expectTodo: false,
    request: '2 的 10 次方是多少？',
  },
  {
    id: 's02',
    category: 'single',
    label: '翻译一句话',
    expectTodo: false,
    request: '把这句话翻译成英文：今天天气真不错',
  },
  {
    id: 's03',
    category: 'single',
    label: '概念解释',
    expectTodo: false,
    request: '什么是依赖注入？用一句话解释一下',
  },
  // ── 边界模糊（最可能不稳定）────────────────────────────────────
  {
    id: 'a01',
    category: 'ambiguous',
    label: '单交付物：写请假邮件',
    expectTodo: false,
    request: '帮我写一封请假邮件',
  },
  {
    id: 'a02',
    category: 'ambiguous',
    label: '研究对比+购买建议',
    expectTodo: false,
    request: '比较一下 iPhone 和 Android 的优缺点，给我一个购买建议',
  },
  {
    id: 'a03',
    category: 'ambiguous',
    label: '查询类：查明天天气',
    expectTodo: false,
    request: '帮我查一下明天北京的天气',
  },
];
