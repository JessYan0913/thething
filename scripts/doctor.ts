#!/usr/bin/env node
// ============================================================
// Doctor CLI — 诊断 + 修复 TheThing 数据目录/数据库（应用起不来时的兜底入口）
// ============================================================
// 与 /doctor 聊天指令共用同一确定性引擎（core modules/doctor）。
//
// 用法（tsx 运行，可 import core TS）：
//   pnpm doctor                                                             # 只报告（只读）
//   pnpm doctor --json                                                      # 结构化报告
//   pnpm doctor --fix                                                       # 修复：safe 自动，destructive 询问
//   pnpm doctor --fix --yes                                                 # 修复：全部自动
//   pnpm doctor --check <id>                                                # 只跑单项
// 等价底层：pnpm --filter @the-thing/core exec tsx ../../scripts/doctor.ts
//
// 默认（报告）模式绝不写库；--fix 才构造 dataStore 执行修复。
//
// 注意：脚本须为 .ts（CJS 包内编译为 CommonJS，import 走 require 运行时属性
// 访问，命名导出全部可用）；若用 .mts（ESM）静态导入，tsx 的 __export CJS 转译
// 会使 cjs-module-lexer 检测失败（仅剩 default）。同时直接 import core 源码
// 叶子文件，而非 @the-thing/core 桶导出——桶会拖入 scanner 的顶层 await
// （CJS 转换报错）。叶子导入两者都避开。

import { createDoctorContext, runDoctor } from '../packages/core/src/modules/doctor/index';
import { applyRepair, REPAIRS } from '../packages/core/src/modules/doctor/repairs';
import { resolveTheThingLayout } from '../packages/core/src/modules/doctor/layout';
import { createSQLiteDataStore } from '../packages/core/src/services/datastore/sqlite/sqlite-data-store';
import type { DoctorReport, RepairOutcome } from '../packages/core/src/modules/doctor/types';
import { createInterface } from 'readline/promises';

const args = process.argv.slice(2);
const isFix = args.includes('--fix');
const isYes = args.includes('--yes');
const isJson = args.includes('--json');
const checkFilter = args.find((a, i) => args[i - 1] === '--check');
const isTTY = Boolean(process.stdin.isTTY);

async function main(): Promise<void> {
  const layout = resolveTheThingLayout();
  // --fix 才构造 dataStore（构造会 mkdir/初始化 schema，报告模式绝不构造）
  const dataStore = isFix ? createSQLiteDataStore({ dataDir: layout.dataDir }) : undefined;
  const ctx = createDoctorContext({ layout, dataStore });

  const report = await runDoctor(ctx);
  const filtered: DoctorReport = checkFilter
    ? { ...report, checks: report.checks.filter((c) => c.id === checkFilter) }
    : report;

  if (isJson) {
    process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
  } else {
    printReport(filtered);
  }

  if (isFix) {
    await runFixes(ctx, filtered);
  }

  dataStore?.close?.();
  process.exit(filtered.summary.error > 0 ? 1 : 0);
}

function printReport(report: DoctorReport): void {
  console.log(`\nDoctor 报告  ${report.configDir}`);
  console.log(`数据目录: ${report.dataDir}`);
  console.log('');
  const groups = new Map<string, typeof report.checks>();
  for (const check of report.checks) {
    const list = groups.get(check.category) ?? [];
    list.push(check);
    groups.set(check.category, list);
  }
  const CATEGORY_LABELS: Record<string, string> = {
    database: '数据库',
    'data-dir': '数据目录',
    wiki: 'Wiki',
    'secondary-db': '次要数据库',
  };
  for (const [category, checks] of groups) {
    console.log(`── ${CATEGORY_LABELS[category] ?? category} ──`);
    for (const check of checks) {
      const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
      const fix = check.fixHint ? `  [修复: ${check.fixHint}]` : '';
      console.log(`  ${icon} ${check.title} — ${check.message}${fix}`);
    }
    console.log('');
  }
  const { ok, warn, error } = report.summary;
  console.log(`汇总: ${ok} 项正常, ${warn} 项警告, ${error} 项错误\n`);
}

async function runFixes(ctx: ReturnType<typeof createDoctorContext>, report: DoctorReport): Promise<void> {
  const fixIds = [...new Set(report.checks.filter((c) => c.fixHint).map((c) => c.fixHint!))];
  if (fixIds.length === 0) {
    console.log('无需修复。');
    return;
  }
  for (const id of fixIds) {
    const repair = REPAIRS.find((r) => r.id === id);
    if (!repair) continue;
    let confirmed = repair.safety !== 'destructive' || isYes;
    if (repair.safety === 'destructive' && !isYes && isTTY) {
      confirmed = await confirm(`破坏性修复「${repair.title}」(${id})，确认执行？[y/N] `);
    }
    if (repair.safety === 'destructive' && !confirmed) {
      console.log(`  ✗ 跳过（破坏性未确认）：${id}`);
      continue;
    }
    const outcome = await applyRepair(ctx, id, { confirmed });
    printOutcome(id, outcome);
  }
}

function printOutcome(id: string, outcome: RepairOutcome): void {
  if (outcome.status === 'done') {
    console.log(`  ✓ 修复 ${id}: ${outcome.message}`);
  } else if (outcome.status === 'needs-confirmation') {
    console.log(`  ⚠ 修复 ${id} 需确认: ${outcome.message}`);
  } else {
    console.log(`  ✗ 修复 ${id} 失败: ${outcome.message}`);
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error('Doctor 执行失败:', e instanceof Error ? e.message : e);
  process.exit(1);
});
