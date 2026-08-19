/**
 * 测量补全真实 dynamic 区（recalled-wiki + recalled-memory）后的缓存前缀占比。
 *
 * 测量点（与 builder.ts 一致）：
 *   - priority < 50  → 缓存前缀（固定区）
 *   - priority = 50  → DYNAMIC_BOUNDARY（边界标记）
 *   - priority >= 51 → dynamic 区（recalled-wiki/recalled-memory/todo-overview 等）
 *
 * 注入数据：
 *   - 6 条真实用户记忆 → 临时 memoryBaseDir 的 6 个 .md 文件
 *   - 真实 wiki 召回（index.md 全文）→ wikiContext.recalledContent
 *   - 真实 todo 概览（sections 里的 todoOverview content）
 *
 * 运行：npx tsx scripts/measure-prefix.ts （在 packages/core 下）
 */
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSystemPrompt } from '../src/modules/system-prompt/builder';

// 与 builder.estimateTokens 一致：~4 chars/token
const token = (s: string | number) => Math.ceil(String(s).length / 4);

// 真实 wiki 召回（index.md 全文，来自当前上下文）
const RECALLED_WIKI = `# index.md

> 此文件是知识库的入口。查询时先读此文件，再读相关页面。

## agent

- [[Agent-Context-Builder]] (agent/agent-context-builder.md) — Agent Context Builder指令/知识/工具组装
- [[Agent-Executor-SubAgent]] (agent/agent-executor-subagent.md) — Agent Executor与子代理上下文传递
- [[Agent-Skills]] (agent/agent-skills.md) — Anthropic Agent Skills 概念与规范
- [[Anthropic-Skills-README]] (agent/anthropic-skills-readme.md) — Anthropic Skills 仓库 README 原文
- [[Compaction-Context-Compression]] (agent/compaction-context-compression.md) — Compaction上下文压缩与视图
- [[Connector-Context-Mapping]] (agent/connector-context-mapping.md) — # 连接器(Connector)层与外部平台上下文对接
- [[Content-Replacement-Tool-Output]] (agent/content-replacement-tool-output.md) — Content Replacement与工具输出处理
- [[Goal-Continuation-Injection]] (agent/goal-continuation-injection.md) — # Goal 模块持续驱动与 Continuation Prompt 注入
- [[Pipeline-PrepareStep-Injection]] (agent/pipeline-preparestep-injection.md) — Pipeline prepareStep动态注入
- [[Session-State-PipelineContext]] (agent/session-state-pipelinecontext.md) — Session State与PipelineContext分析
- [[System-Prompt-Context-Injection]] (agent/system-prompt-context-injection.md) — # System Prompt 上下文注入机制
- [[TokenBudget-CostTracking-Gate]] (agent/tokenbudget-costtracking-gate.md) — Token Budget与Cost Tracking闸门
- [[Wiki-System-Architecture]] (agent/wiki-system-architecture.md) — ### misc/ — 兜底

## project

- [[TheThing上下文传递分析计划]] (project/thething上下文传递分析计划.md) — ## TheThing 上下文传递分析任务清单
- [[TheThing营销方案]] (project/thething营销方案.md) — # TheThing 完整营销方案（实战应用）
- [[TodoWrite调用模式分析]] (project/todowrite调用模式分析.md) — todo_write 工具的全链路调用模式分析
- [[Todo系统优化计划]] (project/todo系统优化计划.md) — TODO 系统优化开发任务清单
- [[write工具输出路径确定机制]] (project/write工具输出路径确定机制.md) — write_file 工具如何确定最终写入路径的完整链路与安全校验

## domain

- [[DeepSeek Harness]] (domain/deepseek-harness.md) — # DeepSeek Harness (dsh)
- [[小红书爆款底层逻辑]] (domain/小红书爆款底层逻辑.md) — # 小红书爆款底层逻辑（基于实测爆款样本）
- [[营销专家智库]] (domain/营销专家智库.md) — # TheThing 营销专家智库（总览）

## domain/books

- [[从0到1-创新与垄断思维]] (domain/books/从0到1-创新与垄断思维.md) — # 《从0到1》核心框架（Peter Thiel）
- [[博弈心理与策略思维]] (domain/books/博弈心理与策略思维.md) — # 商业博弈思维（《策略思维》奈尔伯夫 + 《博弈心理学》）
- [[定位-心智占领理论]] (domain/books/定位-心智占领理论.md) — # 《定位》核心理论（艾·里斯 & 特劳特）
- [[富爸爸穷爸爸-财商核心]] (domain/books/富爸爸穷爸爸-财商核心.md) — # 《富爸爸穷爸爸》核心财商概念
- [[影响力-说服六大原则]] (domain/books/影响力-说服六大原则.md) — # 《影响力》六大说服原则（Robert Cialdini）

## misc

- [[TheThing-Context-Passing-Architecture]] (misc/thething-context-passing-architecture.md) — # TheThing 上下文传递架构 — 完整分析报告
- [[TheThing模块依赖架构]] (misc/thething模块依赖架构.md) — # TheThing 模块依赖架构（四层综合报告）`;

// 6 条真实用户记忆（本应 file 的 id 用原 id，内容来自上下文）
const MEMORIES = [
  {
    content: '同一篇文章不要重复发布到小红书，重复发布相同内容会触发平台风控，可能导致封号',
    type: 'correction',
    source: '用户说"你再发布会被封号的同样的文章，你已经发布好几遍了"',
    importance: 8,
  },
  {
    content: '周末不喜欢被打扰，任务和联系安排在周一至周五工作日进行',
    type: 'explicit',
    source: '用户说"记住：我周末不喜欢被打扰，工作日再安排"',
    importance: 7,
  },
  {
    content: '汇报一律用文字表述，不使用表格',
    type: 'correction',
    dimension: 'display-format',
    source: '用户说"汇报不要用表格了，一律文字"',
    importance: 8,
  },
  {
    content: '黄金分析日报不应被放入wiki，应删除或另行处理',
    type: 'correction',
    source: '用户要求删除黄金分析日报并指出不应进入wiki',
    importance: 7,
  },
  {
    content: '对财经、商业、营销类书籍感兴趣',
    type: 'preference',
    source: '学习《富爸爸穷爸爸》《从0到1》',
    importance: 4,
  },
  {
    content: '关注个人成长和营销策略',
    type: 'preference',
    source: '要求成为营销专家，写小红书',
    importance: 4,
  },
];

// 真实 todo 概览（来自上下文动态区内容）
const TODO_OVERVIEW = `## 待办
- [ ] 重新测量补全 dynamic 区后的前缀占比 (id: todo-bBNC8FJU)
- [ ] 向用户文字汇报补全后数字与结论 (id: todo-W8nmbA0t)

### 最近完成
- [ ] 定位 recalled-wiki 与 recalled-memory 的 section 工厂及 priority (id: todo-NUzeS58T)
- [ ] 获取真实 wiki 召回与用户记忆内容作为测量输入 (id: todo-mbD6lpmw)`;

// 真实会话信息（来自上下文）
const SESSION_META = `【会话信息】

当前时间：2026-08-19 08:45 (UTC)
会话来源：local
这是第 4 条消息。`;

async function main() {
  // 1. 临时 memoryBaseDir，写入 6 条真实记忆
  const memoryBaseDir = await mkdtemp(join(tmpdir(), 'thething-mem-measure-'));
  for (let i = 0; i < MEMORIES.length; i++) {
    const m = MEMORIES[i];
    const frontmatter = [
      `content: ${m.content}`,
      `type: ${m.type}`,
      m.dimension ? `dimension: ${m.dimension}` : null,
      `source: ${m.source}`,
      `importance: ${m.importance}`,
    ]
      .filter(Boolean)
      .join('\n');
    const md = `---\n${frontmatter}\n---\n\n${m.content}\n`;
    await writeFile(join(memoryBaseDir, `mem-${i}.md`), md, 'utf-8');
  }

  // 2. 调用 buildSystemPrompt，注入真实 wiki 召回 + memoryBaseDir + 真实 todo/session
  const result = await buildSystemPrompt({
    wikiContext: { recalledContent: RECALLED_WIKI },
    memoryBaseDir,
    memoryQuery: '帮助用户：营销、财经、小红书、金价分析、汇报、偏好',
    memoryTopK: 20,
    todoOverview: TODO_OVERVIEW,
    sessionMeta: SESSION_META,
    // 其余用默认（soulMd / customPrompt 由 builder 内部加载，保持真实）
  });

  // 3. 分桶统计
  const sections = result.sections as Array<{
    name: string;
    content: string;
    priority: number;
    cacheStrategy?: string;
  }>;

  let prefixChars = 0;
  let dynamicChars = 0;
  let totalChars = 0;
  const rows: Array<{ name: string; prio: number; chars: number; tokens: number; zone: string }> = [];

  for (const s of sections) {
    const chars = s.content.length;
    const tk = token(s.content);
    totalChars += chars;
    const zone = s.priority < 50 ? 'PREFIX' : s.priority === 50 ? 'BOUNDARY' : 'DYNAMIC';
    if (s.priority < 50) prefixChars += chars;
    else dynamicChars += chars;
    rows.push({ name: s.name, prio: s.priority, chars, tokens: tk, zone });
  }

  // 4. 输出
  console.log('=== 各 section 统计 ===');
  for (const r of rows) {
    console.log(
      `[${r.zone.padEnd(8)}] p=${String(r.prio).padStart(3)} ${r.name.padEnd(40)} ${String(r.chars).padStart(5)} chars / ${String(r.tokens).padStart(4)} tok`,
    );
  }

  const prefixTok = token(prefixChars);
  const dynamicTok = token(dynamicChars);
  const totalTok = token(totalChars + ((result.prompt?.length ?? totalChars) - totalChars)); // 用 sections 口径
  const totalTokSections = token(totalChars);
  const ratio = totalChars > 0 ? (prefixChars / totalChars) * 100 : 0;

  console.log('\n=== 汇总（sections 口径） ===');
  console.log(`前缀区(p<50) chars : ${prefixChars}  (${prefixTok} tok)`);
  console.log(`dynamic + boundary : ${dynamicChars}  (${dynamicTok} tok)`);
  console.log(`总计 chars          : ${totalChars}  (${totalTokSections} tok)`);
  console.log(`前缀占比            : ${ratio.toFixed(2)}%`);
  console.log(`前缀 token 占比     : ${(totalTokSections ? (prefixTok / totalTokSections) * 100 : 0).toFixed(2)}%`);

  console.log('\n=== 完整 prompt 口径 ===');
  const fullPrompt = result.prompt ?? '';
  const fullTok = token(fullPrompt);
  console.log(`prompt chars        : ${fullPrompt.length}`);
  console.log(`prompt tokens       : ${fullTok}`);
  console.log(`prompt 中前缀字符数  : ${prefixChars}`);
  console.log(`prompt 前缀占比     : ${fullPrompt.length ? (prefixChars / fullPrompt.length) * 100 : 0}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
