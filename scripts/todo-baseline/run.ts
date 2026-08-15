// ============================================================
// Todo Baseline 驱动 (Phase 0)
// ============================================================
// 在真实 agent 上逐条跑固定请求集，记录 todo 行为，产出基线报告。
//
// 用法：
//   pnpm --filter @the-thing/core exec tsx ../../scripts/todo-baseline/run.ts
//   pnpm --filter @the-thing/core exec tsx ../../scripts/todo-baseline/run.ts --model=deepseek-v4-flash --cases=g01 --limit=1 --max-steps=12 --timeout-ms=150000
//
// 环境：需 ~/.agents/models.json（用户模型配置）；可用 THETHING_API_KEY/THETHING_BASE_URL 覆盖。
//
// 安全：resourceRoot/dataDir/configDir 全部指向临时沙箱，不触碰真实 ~/.thething；
//       禁用 mcps/connectors/skills，只保留核心工具（读/写/编辑/glob/grep/bash/web-fetch 等）。

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { bootstrap, createContext, createAgent } from '@the-thing/core';
import { convertToModelMessages } from 'ai';
import { CASES, type BaselineCase, type CaseCategory } from './cases';

// ============================================================
// Types
// ============================================================

interface StepRecord {
  stepIndex: number;
  tools: string[];
  todoCount: number;
  inProgress: number;
  completed: number;
  failed: number;
}

interface TodoToolCall {
  step: number;
  name: string;
  /** todo_write: 传入的完整列表；todo_create_batch: 传入的任务数；其余: 无 */
  inputSummary: string;
  /** 工具返回值（截断） */
  output: string;
}

interface CaseResult {
  id: string;
  category: CaseCategory;
  label: string;
  expectTodo: boolean;
  request: string;
  /** 结束时 todo 数量 */
  created: number;
  /** 第一个"规划"调用（todo_write / todo_create_batch）所在的 stepIndex，未建为 null */
  firstPlanStep: number | null;
  /** 建过单但结束时为空（规划被整表替换清空/删除） */
  plannedButEmpty: boolean;
  /** 结束时各状态计数 */
  statuses: Record<string, number>;
  /** 建单后状态是否发生过流转（有任何 completed/failed/cancelled） */
  progressed: boolean;
  /** 跟进度：清单被 todo 工具触碰的总次数（创建算 1 次；>1 = 建后还有更新） */
  todoMutations: number;
  /** 建单后是否至少更新过一次清单（区别于"只创建不跟进"） */
  followedUp: boolean;
  /** 已完成且带 result 的占比 */
  resultCoverage: number | null;
  /** 每步 todo 状态演变 */
  steps: StepRecord[];
  /** todo 工具调用明细（输入+输出） */
  todoToolCalls: TodoToolCall[];
  /** 全流程工具调用序列 */
  toolSequence: string[];
  /** 步数 */
  stepCount: number;
  /** 输入 token 数（所有步之和） */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 结束原因 */
  finishReason: string;
  /** 最终回复文本（截断） */
  finalText: string;
  error?: string;
}

interface Report {
  model: string;
  baseURL: string;
  timestamp: string;
  cases: CaseResult[];
  metrics: {
    total: number;
    multi: number;
    multiCreated: number;
    multiCreationRate: number; // 多步建单率（核心指标）
    multiCodeCreated: number;
    multiCodeRate: number;
    multiGeneralCreated: number;
    multiGeneralRate: number; // 编码 vs 非编码对比（验证触发词汇错配）
    single: number;
    singleFalsePositive: number; // 单步误建率
    ambiguous: number;
    ambiguousCreated: number;
    ambiguousRate: number;
    plannedButEmpty: number; // 规划过但清单被清空
    progressRate: number; // 已建单用例中"推进过状态"的占比
    followThroughRate: number; // 已建单用例中"建后至少再更新过一次清单"的占比（专测"只开工不跟进"）
    avgTodoMutations: number | null; // 已建单用例的平均清单触碰次数
    avgFirstPlanStep: number | null;
    resultCoverage: number | null;
  };
}

// ============================================================
// 模型配置加载（对齐 CLI：~/.agents/models.json）
// ============================================================

async function loadModelConfig(modelOverride?: string) {
  const configPath = path.join(os.homedir(), '.agents', 'models.json');
  const raw = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  const providers: Array<{ name: string; baseURL: string; apiKey: string; models: Array<{ id: string }> }> = raw.providers ?? [];

  const defaultModel = modelOverride ?? raw.defaultModel ?? providers[0]?.models?.[0]?.id;
  const provider =
    providers.find((p) => (p.models ?? []).some((m) => m.id === defaultModel)) ?? providers[0];

  return {
    apiKey: process.env.THETHING_API_KEY || provider?.apiKey,
    baseURL: process.env.THETHING_BASE_URL || provider?.baseURL,
    modelName: defaultModel,
  };
}

// ============================================================
// 沙箱
// ============================================================

const STORE_STUB = `// 待重构的存储类（baseline 沙箱）
export class Store {
  private items: string[] = [];
  constructor(private readonly name: string) {}

  getItems(): string[] {
    return [...this.items];
  }

  addItem(item: string): void {
    this.items.push(item);
  }

  get size(): number {
    return this.items.length;
  }
}
`;

async function setupSandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thething-todo-baseline-'));
  const cwd = path.join(root, 'cwd');
  const configDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');

  await fs.mkdir(path.join(cwd, 'src', 'utils'), { recursive: true });
  for (const sub of ['skills', 'agents', 'mcps', 'connectors', 'permissions', 'wiki', 'memory', 'tasks']) {
    await fs.mkdir(path.join(configDir, sub), { recursive: true });
  }
  await fs.mkdir(dataDir, { recursive: true });

  await fs.writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify(
      { name: 'baseline-sandbox', private: true, scripts: { test: 'vitest run' }, devDependencies: { vitest: '^3.0.0' } },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(cwd, 'tsconfig.json'),
    JSON.stringify(
      { compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', strict: true }, include: ['src'] },
      null,
      2,
    ),
  );
  await fs.writeFile(path.join(cwd, 'src', 'utils', 'store.ts'), STORE_STUB);

  return { root, cwd, configDir, dataDir };
}

// ============================================================
// 单条用例
// ============================================================

function countStatuses(todos: Array<{ status: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of todos) out[t.status] = (out[t.status] ?? 0) + 1;
  return out;
}

function toolNameOf(tc: unknown): string {
  const t = tc as { name?: string; toolName?: string };
  return t?.toolName ?? t?.name ?? '?';
}

function summarizeInput(name: string, input: unknown): string {
  const i = input as { todos?: unknown[]; tasks?: unknown[]; id?: string } | undefined;
  if (name === 'todo_write') return `list=${i?.todos?.length ?? 0} ${JSON.stringify(i?.todos?.map((t) => (t as { subject?: string }).subject ?? '')).slice(0, 200)}`;
  if (name === 'todo_create_batch') return `tasks=${i?.tasks?.length ?? 0} ${JSON.stringify(i?.tasks?.map((t) => (t as { subject?: string }).subject ?? '')).slice(0, 200)}`;
  if (name === 'todo_list') return `id=${i?.id ?? '(snapshot)'}`;
  if (name === 'todo_delete') return `id=${i?.id ?? '?'}`;
  return JSON.stringify(input).slice(0, 120);
}

async function runCase(
  ctx: Awaited<ReturnType<typeof createContext>>,
  model: { apiKey: string; baseURL: string; modelName: string },
  cse: BaselineCase,
  opts: { maxSteps: number; timeoutMs: number },
): Promise<CaseResult> {
  const conversationId = nanoid();
  const userMsg = { id: nanoid(), role: 'user' as const, parts: [{ type: 'text' as const, text: cse.request }] };

  // 关键：todo 表有 conversations 外键，真实流程在发消息前已建会话行。
  // 无此步 → todo_write 全部 FOREIGN KEY constraint failed（前期基线被此工件污染）。
  ctx.runtime.dataStore.conversationStore.createConversation(conversationId, cse.id);

  const stepRecords: StepRecord[] = [];
  const todoToolCalls: TodoToolCall[] = [];
  let finalText = '';
  let finishReason = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | undefined;
  let statuses: Record<string, number> = {};
  let toolSequence: string[] = [];
  let created = 0;

  const agentResult = await createAgent({
    context: ctx,
    conversationId,
    messages: [userMsg],
    model,
    autoApprove: true,
    approvalMode: 'full-trust',
    modules: { mcps: false, connectors: false, skills: false, permissions: true, compaction: true },
    conversationMeta: { isNewConversation: true, sessionSource: 'user', conversationStartTime: Date.now() },
  });

  const { agent, sessionState, adjustedMessages, dispose } = agentResult;
  const todoStore = sessionState.todoStore;

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), opts.timeoutMs);

  try {
    const modelMessages = (await convertToModelMessages((adjustedMessages ?? [userMsg]) as never)) as never;
    const result = await agent.generate({
      messages: modelMessages,
      abortSignal: abortController.signal,
      onStepEnd: (event) => {
        const step = event as { toolCalls?: Array<{ name?: string; input?: unknown }> };
        const toolCalls = step?.toolCalls ?? [];
        const tools = toolCalls.map(toolNameOf);
        const todos = todoStore.getTodosByConversation(conversationId);
        const st = countStatuses(todos);
        const stepIndex = stepRecords.length;
        for (const tc of toolCalls) {
          const tcName = toolNameOf(tc);
          if (!tcName || !tcName.startsWith('todo_')) continue;
          if (!todoToolCalls.some((t) => t.step === stepIndex && t.name === tcName)) {
            todoToolCalls.push({
              step: stepIndex,
              name: tcName,
              inputSummary: summarizeInput(tcName, (tc as { input?: unknown }).input),
              output: '',
            });
          }
        }
        stepRecords.push({
          stepIndex,
          tools,
          todoCount: todos.length,
          inProgress: st.in_progress ?? 0,
          completed: st.completed ?? 0,
          failed: st.failed ?? 0,
        });
      },
    } as never);

    finalText = (result.text ?? '').slice(0, 600);
    finishReason = result.finishReason;
    inputTokens = result.usage?.inputTokens ?? 0;
    outputTokens = result.usage?.outputTokens ?? 0;
    toolSequence = (result.steps ?? []).flatMap((s) => (s.toolCalls ?? []).map(toolNameOf));

    // todo 工具返回值（onStepEnd 已录输入，此处补输出）
    for (let si = 0; si < (result.steps ?? []).length; si++) {
      const s = (result.steps as unknown as { toolCalls?: Array<{ name: string; input: unknown }>; toolResults?: Array<{ toolName?: string; name?: string; result: unknown; output?: unknown }> }[])[si];
      for (const tc of s?.toolCalls ?? []) {
        const tcName = toolNameOf(tc);
        if (!tcName || !tcName.startsWith('todo_')) continue;
        const res = (s.toolResults ?? []).find((r) => (r.toolName ?? r.name) === tcName);
        const existing = todoToolCalls.find((t) => t.step === si && t.name === tcName);
        if (existing) {
          existing.output = JSON.stringify(res?.result ?? res?.output ?? '').slice(0, 300);
        } else {
          todoToolCalls.push({
            step: si,
            name: tcName,
            inputSummary: summarizeInput(tcName, (tc as { input?: unknown }).input),
            output: JSON.stringify(res?.result ?? res?.output ?? '').slice(0, 300),
          });
        }
      }
    }
  } catch (e) {
    const aborted = abortController.signal.aborted;
    error = aborted
      ? 'timeout'
      : e instanceof Error
        ? `${e.name}: ${e.message}`.slice(0, 400)
        : String(e).slice(0, 400);
  } finally {
    clearTimeout(timer);
  }

  const todos = todoStore.getTodosByConversation(conversationId);
  created = todos.length;
  statuses = countStatuses(todos);

  const firstPlan = stepRecords.findIndex((r) =>
    r.tools.some((t) => t === 'todo_write' || t === 'todo_create_batch'),
  );
  const firstPlanStep = firstPlan >= 0 ? stepRecords[firstPlan].stepIndex : null;

  const completedTodos = todos.filter((t) => t.status === 'completed');
  const withResult = completedTodos.filter((t) => t.metadata?.result);
  const resultCoverage = completedTodos.length > 0 ? withResult.length / completedTodos.length : null;

  await dispose();

  return {
    id: cse.id,
    category: cse.category,
    label: cse.label,
    expectTodo: cse.expectTodo,
    request: cse.request,
    created,
    firstPlanStep,
    plannedButEmpty: firstPlanStep != null && created === 0,
    statuses,
    progressed: (statuses.completed ?? 0) + (statuses.failed ?? 0) + (statuses.cancelled ?? 0) > 0,
    todoMutations: todoToolCalls.length,
    followedUp: todoToolCalls.length > 1,
    resultCoverage,
    steps: stepRecords,
    todoToolCalls,
    toolSequence,
    stepCount: stepRecords.length,
    inputTokens,
    outputTokens,
    finishReason,
    finalText,
    error,
  };
}

// ============================================================
// 指标与报告
// ============================================================

function buildReport(cases: CaseResult[], model: string, baseURL: string): Report {
  const by = (cat: CaseCategory) => cases.filter((c) => c.category === cat);
  const multi = [...by('multi-code'), ...by('multi-general')];
  const multiCreated = multi.filter((c) => c.created > 0);
  const multiCode = by('multi-code');
  const multiGeneral = by('multi-general');
  const single = by('single');
  const ambiguous = by('ambiguous');
  const createdCases = cases.filter((c) => c.created > 0);

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    model,
    baseURL,
    timestamp: new Date().toISOString(),
    cases,
    metrics: {
      total: cases.length,
      multi: multi.length,
      multiCreated: multiCreated.length,
      multiCreationRate: multi.length ? multiCreated.length / multi.length : 0,
      multiCodeCreated: multiCode.filter((c) => c.created > 0).length,
      multiCodeRate: multiCode.length ? multiCode.filter((c) => c.created > 0).length / multiCode.length : 0,
      multiGeneralCreated: multiGeneral.filter((c) => c.created > 0).length,
      multiGeneralRate: multiGeneral.length
        ? multiGeneral.filter((c) => c.created > 0).length / multiGeneral.length
        : 0,
      single: single.length,
      singleFalsePositive: single.length ? single.filter((c) => c.created > 0).length / single.length : 0,
      ambiguous: ambiguous.length,
      ambiguousCreated: ambiguous.filter((c) => c.created > 0).length,
      ambiguousRate: ambiguous.length ? ambiguous.filter((c) => c.created > 0).length / ambiguous.length : 0,
      plannedButEmpty: cases.filter((c) => c.plannedButEmpty).length,
      progressRate: createdCases.length
        ? createdCases.filter((c) => c.progressed).length / createdCases.length
        : 0,
      followThroughRate: createdCases.length
        ? createdCases.filter((c) => c.followedUp).length / createdCases.length
        : 0,
      avgTodoMutations: avg(createdCases.map((c) => c.todoMutations)),
      avgFirstPlanStep: avg(createdCases.map((c) => c.firstPlanStep ?? NaN).filter((n) => !Number.isNaN(n))),
      resultCoverage: createdCases.length
        ? avg(createdCases.map((c) => c.resultCoverage ?? NaN).filter((n) => !Number.isNaN(n)))
        : null,
    },
  };
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(0)}%`;
}

function renderMd(report: Report): string {
  const m = report.metrics;
  const lines: string[] = [];
  lines.push('# Todo Baseline Report');
  lines.push('');
  lines.push(`- 模型: ${report.model}`);
  lines.push(`- 时间: ${report.timestamp}`);
  lines.push('');
  lines.push('## 核心指标');
  lines.push('');
  lines.push('| 指标 | 值 |');
  lines.push('|------|----|');
  lines.push(`| 多步建单率（核心） | ${pct(m.multiCreationRate)} (${m.multiCreated}/${m.multi}) |`);
  lines.push(`| ├ 编码域多步 | ${pct(m.multiCodeRate)} (${m.multiCodeCreated}/${report.cases.filter((c) => c.category === 'multi-code').length}) |`);
  lines.push(`| ├ 非编码域多步 | ${pct(m.multiGeneralRate)} (${m.multiGeneralCreated}/${report.cases.filter((c) => c.category === 'multi-general').length}) |`);
  lines.push(`| 单步误建率 | ${pct(m.singleFalsePositive)} |`);
  lines.push(`| 边界模糊建单率 | ${pct(m.ambiguousRate)} (${m.ambiguousCreated}/${m.ambiguous}) |`);
  lines.push(`| 规划过但清单被清空 | ${m.plannedButEmpty} 条 |`);
  lines.push(`| 建单后推进率 | ${pct(m.progressRate)} |`);
  lines.push(`| 建单后跟进率（建后再更新≥1次） | ${pct(m.followThroughRate)} |`);
  lines.push(`| 平均清单触碰次数 | ${m.avgTodoMutations == null ? '—' : m.avgTodoMutations.toFixed(1)} |`);
  lines.push(`| 平均首建步 | ${m.avgFirstPlanStep == null ? '—' : m.avgFirstPlanStep.toFixed(1)} |`);
  lines.push(`| result 完备率 | ${pct(m.resultCoverage)} |`);
  lines.push('');
  lines.push('## 逐条明细');
  lines.push('');
  lines.push('| id | 类别 | 标签 | 建单 | 首建步 | 清空 | 推进 | 跟进 | 触碰 | 步数 | 结束 | 工具序列 |');
  lines.push('|----|------|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|------|');
  for (const c of report.cases) {
    lines.push(
      `| ${c.id} | ${c.category} | ${c.label} | ${c.created > 0 ? '✅' : '—'} | ${c.firstPlanStep ?? '—'} | ` +
        `${c.plannedButEmpty ? '⚠️' : '—'} | ${c.progressed ? '✅' : '—'} | ${c.followedUp ? '✅' : '—'} | ${c.todoMutations} | ${c.stepCount} | ${c.finishReason} | ` +
        `${c.toolSequence.slice(0, 16).join('→')}${c.toolSequence.length > 16 ? '…' : ''} |`,
    );
  }
  lines.push('');
  lines.push('## todo 工具调用明细');
  lines.push('');
  for (const c of report.cases) {
    if (c.todoToolCalls.length === 0) continue;
    lines.push(`### ${c.id} ${c.label}`);
    lines.push('');
    lines.push('```');
    for (const tc of c.todoToolCalls) {
      lines.push(`#step${tc.step} ${tc.name}  IN: ${tc.inputSummary}`);
      lines.push(`    OUT: ${tc.output}`);
    }
    lines.push('```');
    lines.push('');
  }
  lines.push('## 每步 todo 状态演变');
  lines.push('');
  for (const c of report.cases) {
    lines.push(`### ${c.id} ${c.label}`);
    lines.push('');
    lines.push('```');
    for (const s of c.steps) {
      lines.push(`step${s.stepIndex}: todo=${s.todoCount} (inP=${s.inProgress} done=${s.completed} fail=${s.failed}) tools=${s.tools.join(',') || '-'}`);
    }
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

// ============================================================
// Main
// ============================================================

function parseArgs(argv: string[]) {
  const out: Record<string, string | undefined> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = 'true';
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelOverride = args.model;
  const caseFilter = args.cases ? args.cases.split(',') : undefined;
  const limit = args.limit ? Number(args.limit) : undefined;
  const maxSteps = args['max-steps'] ? Number(args['max-steps']) : 12;
  const timeoutMs = args['timeout-ms'] ? Number(args['timeout-ms']) : 150_000;

  const model = await loadModelConfig(modelOverride);
  if (!model.apiKey || !model.baseURL) {
    console.error('[baseline] 缺少模型配置。请检查 ~/.agents/models.json 或设置 THETHING_API_KEY/THETHING_BASE_URL');
    process.exit(1);
  }

  const sandbox = await setupSandbox();
  console.log(`[baseline] model=${model.modelName} baseURL=${model.baseURL}`);
  console.log(`[baseline] maxSteps=${maxSteps} timeoutMs=${timeoutMs}`);
  console.log(`[baseline] sandbox=${sandbox.root} (临时目录，运行后保留供检查)`);

  const runtime = await bootstrap({
    layout: { resourceRoot: sandbox.cwd, configDir: sandbox.configDir, dataDir: sandbox.dataDir },
    behavior: { maxStepsPerSession: maxSteps },
    env: { ...process.env },
  });
  const ctx = await createContext({ runtime });

  let cases = CASES;
  if (caseFilter) cases = cases.filter((c) => caseFilter.includes(c.id));
  if (limit != null) cases = cases.slice(0, limit);
  const repeat = args.repeat ? Number(args.repeat) : 1;
  if (repeat > 1) {
    const expanded: typeof cases = [];
    for (const c of cases) for (let i = 0; i < repeat; i++) expanded.push({ ...c, id: `${c.id}#${i + 1}` });
    cases = expanded;
  }

  console.log(`[baseline] 运行 ${cases.length} 条用例…`);
  const results: CaseResult[] = [];
  for (const cse of cases) {
    const t0 = Date.now();
    console.log(`\n[baseline] ── ${cse.id} [${cse.category}] ${cse.label} ──`);
    const r = await runCase(ctx, model, cse, { maxSteps, timeoutMs });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[baseline] ${cse.id}: created=${r.created} firstPlan=${r.firstPlanStep ?? '—'} ${r.plannedButEmpty ? '清空⚠️ ' : ''}steps=${r.stepCount} ${secs}s${r.error ? ` ${r.error}` : ''}`,
    );
    results.push(r);
  }

  const report = buildReport(results, model.modelName, model.baseURL);
  const md = renderMd(report);

  const outDir = path.join(path.resolve(__dirname, '..', '..'), 'outputs', 'todo-baseline');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(outDir, `${model.modelName}-${stamp}.json`);
  const mdPath = path.join(outDir, `${model.modelName}-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(mdPath, md);
  await fs.writeFile(path.join(outDir, 'latest.json'), JSON.stringify(report, null, 2));

  console.log('\n' + md);
  console.log(`\n[baseline] 报告: ${jsonPath}`);
  console.log(`[baseline] 报告: ${mdPath}`);

  await runtime.dispose();
}

main().catch((e) => {
  console.error('[baseline] fatal:', e);
  process.exit(1);
});
