/**
 * 测量「按需读取 wiki 模式」（不预注入 index 全文）下的缓存前缀占比。
 *
 * 对比 measure-prefix.ts（注入 index 全文 2538 chars 于 dynamic 区）：
 *   本脚本通过真实的 loadWikiContextForAgent 获取固定指引串（~100 chars），
 *   观察前缀占比回升效果。
 *
 * 运行：npx tsx scripts/measure-prefix-wiki-ondemand.ts （在 packages/core 下）
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSystemPrompt } from '../src/modules/system-prompt/builder';
import { loadWikiContextForAgent } from '../src/modules/agent/context/wiki-context';

// 与 builder.estimateTokens 一致：~4 chars/token
const token = (s: string | number) => Math.ceil(String(s).length / 4);

// 6 条真实用户记忆
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

// 真实 todo 概览（与 measure-prefix.ts 一致）
const TODO_OVERVIEW = `## 待办
- [ ] 重新测量补全 dynamic 区后的前缀占比 (id: todo-bBNC8FJU)
- [ ] 向用户文字汇报补全后数字与结论 (id: todo-W8nmbA0t)

### 最近完成
- [ ] 定位 recalled-wiki 与 recalled-memory 的 section 工厂及 priority (id: todo-NUzeS58T)
- [ ] 获取真实 wiki 召回与用户记忆内容作为测量输入 (id: todo-mbD6lpmw)`;

// 真实会话信息
const SESSION_META = `【会话信息】

当前时间：2026-08-19 16:02 (UTC)
会话来源：local
这是第 4 条消息。`;

async function main() {
  // 1. 临时 memoryBaseDir，写入 6 条真实记忆
  const memoryBaseDir = await mkdtemp(join(tmpdir(), 'thething-mem-measure-cl-'));
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

  // 2. 通过真实 loadWikiContextForAgent 获取召回内容（按需读取模式下为固定指引串）
  const wikiCtx = await loadWikiContextForAgent([], '/tmp/nonexistent-wiki-dir');
  console.log('=== 新实现 loadWikiContextForAgent 返回内容 ===');
  console.log(`长度: ${wikiCtx.recalledContent.length} chars / ${token(wikiCtx.recalledContent)} tok`);
  console.log('内容:');
  console.log(wikiCtx.recalledContent);
  console.log('==============================================\n');

  // 3. 调用 buildSystemPrompt
  const result = await buildSystemPrompt({
    wikiContext: { recalledContent: wikiCtx.recalledContent },
    memoryBaseDir,
    memoryQuery: '帮助用户：营销、财经、小红书、金价分析、汇报、偏好',
    memoryTopK: 20,
    todoOverview: TODO_OVERVIEW,
    sessionMeta: SESSION_META,
  });

  // 4. 分桶统计
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
    totalChars += chars;
    const zone = s.priority < 50 ? 'PREFIX' : s.priority === 50 ? 'BOUNDARY' : 'DYNAMIC';
    if (s.priority < 50) prefixChars += chars;
    else dynamicChars += chars;
    rows.push({ name: s.name, prio: s.priority, chars, tokens: token(s.content), zone });
  }

  console.log('=== 各 section 统计 ===');
  for (const r of rows) {
    console.log(
      `[${r.zone.padEnd(8)}] p=${String(r.prio).padStart(3)} ${r.name.padEnd(40)} ${String(r.chars).padStart(5)} chars / ${String(r.tokens).padStart(4)} tok`,
    );
  }

  const prefixTok = token(prefixChars);
  const dynamicTok = token(dynamicChars);
  const totalTokSections = token(totalChars);
  const ratio = totalChars > 0 ? (prefixChars / totalChars) * 100 : 0;

  console.log('\n=== 汇总（sections 口径） ===');
  console.log(`前缀区(p<50) chars : ${prefixChars}  (${prefixTok} tok)`);
  console.log(`dynamic + boundary : ${dynamicChars}  (${dynamicTok} tok)`);
  console.log(`总计 chars          : ${totalChars}  (${totalTokSections} tok)`);
  console.log(`前缀占比            : ${ratio.toFixed(2)}%`);
  console.log(`前缀 token 占比     : ${(totalTokSections ? (prefixTok / totalTokSections) * 100 : 0).toFixed(2)}%`);

  console.log('\n=== 对比 measure-prefix.ts（注入 index 全文） ===');
  console.log(`旧: 前缀区 2595 chars / dynamic 2996 chars / 占比 46.15%`);
  console.log(`新: 前缀区 ${prefixChars} chars / dynamic ${dynamicChars} chars / 占比 ${ratio.toFixed(2)}%`);
  const saved = 2996 - dynamicChars;
  console.log(`dynamic 区减少: ${saved} chars（约 ${token(saved)} tok）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
