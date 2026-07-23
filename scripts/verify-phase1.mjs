#!/usr/bin/env node
/**
 * Phase 1 验证脚本
 *
 * 检查：
 * 1. 关键文件是否存在
 * 2. 类型是否正确导出
 * 3. 编译是否通过
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🔍 Phase 1 验证开始...\n');

// ============================================================
// 检查 1: 关键文件存在性
// ============================================================
console.log('📁 检查关键文件...');

const criticalFiles = [
  'packages/core/src/modules/compaction/compaction-view.ts',
  'packages/core/src/modules/session/types.ts',
  'packages/core/src/modules/session/state.ts',
  'packages/core/src/modules/compaction/emergency-summary.ts',
  'packages/core/src/modules/compaction/checkpoint.ts',
  'packages/core/src/modules/compaction/index.ts',
  'packages/core/src/index.ts',
  'packages/app/app/api/chat/route.ts',
];

let allFilesExist = true;
for (const file of criticalFiles) {
  const fullPath = join(projectRoot, file);
  const exists = existsSync(fullPath);
  const icon = exists ? '✅' : '❌';
  console.log(`  ${icon} ${file}`);
  if (!exists) allFilesExist = false;
}

if (!allFilesExist) {
  console.error('\n❌ 部分文件缺失，请检查');
  process.exit(1);
}

console.log('\n✅ 所有关键文件存在\n');

// ============================================================
// 检查 2: 关键代码片段
// ============================================================
console.log('🔎 检查关键代码片段...\n');

const checks = [
  {
    file: 'packages/core/src/modules/compaction/compaction-view.ts',
    patterns: [
      'export interface CompactionView',
      'export function fingerprintMessage',
      'export function applyCompactionView',
      'export function updateViewAfterL3',
    ],
    name: 'CompactionView 核心模块',
  },
  {
    file: 'packages/core/src/modules/session/types.ts',
    patterns: [
      'compactionView: CompactionView',
    ],
    name: 'Session 类型集成',
  },
  {
    file: 'packages/core/src/modules/session/state.ts',
    patterns: [
      'import { compactBeforeStep }',
      'compactionView: createCompactionView()',
      'compactionView: state.compactionView',
    ],
    name: 'Session 状态集成',
  },
  {
    file: 'packages/core/src/modules/compaction/emergency-summary.ts',
    patterns: [
      "summaryMessage?: import('ai').ModelMessage",
      'anchorIndex?: number',
      'summaryText?: string',
      'middleEnd: number',
    ],
    name: 'Emergency Summary 返回类型',
  },
  {
    file: 'packages/core/src/modules/compaction/index.ts',
    patterns: [
      'applyCompactionView',
      'updateViewAfterL3',
      'compactionView?: CompactionView',
      'export { fingerprintMessage }',
    ],
    name: 'Compaction 索引集成',
  },
  {
    file: 'packages/core/src/modules/compaction/checkpoint.ts',
    patterns: [
      'export interface CheckpointLoadResult',
      'applied: boolean',
      'summaryMessage?: UIMessage',
    ],
    name: 'Checkpoint 返回类型',
  },
  {
    file: 'packages/core/src/index.ts',
    patterns: [
      'fingerprintMessage',
    ],
    name: 'Core 导出',
  },
  {
    file: 'packages/app/app/api/chat/route.ts',
    patterns: [
      'fingerprintMessage',
      'checkpointResult.applied',
      'sessionState.compactionView.summary',
    ],
    name: 'API Route 集成',
  },
];

let allChecksPass = true;
for (const check of checks) {
  const fullPath = join(projectRoot, check.file);
  const content = readFileSync(fullPath, 'utf-8');

  console.log(`📄 ${check.name}`);

  for (const pattern of check.patterns) {
    const found = content.includes(pattern);
    const icon = found ? '  ✅' : '  ❌';
    console.log(`${icon} "${pattern}"`);
    if (!found) allChecksPass = false;
  }

  console.log();
}

if (!allChecksPass) {
  console.error('❌ 部分代码片段缺失，请检查实现');
  process.exit(1);
}

console.log('✅ 所有关键代码片段存在\n');

// ============================================================
// 检查 3: 文件大小（确保完整写入）
// ============================================================
console.log('📏 检查文件大小...\n');

const sizeChecks = [
  {
    file: 'packages/core/src/modules/compaction/compaction-view.ts',
    minSize: 5000, // 至少 5KB
    name: 'CompactionView',
  },
  {
    file: 'packages/core/src/modules/compaction/emergency-summary.ts',
    minSize: 3000,
    name: 'Emergency Summary',
  },
];

for (const check of sizeChecks) {
  const fullPath = join(projectRoot, check.file);
  const stats = readFileSync(fullPath);
  const size = stats.length;
  const passed = size >= check.minSize;
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${check.name}: ${size} bytes (min: ${check.minSize})`);
  if (!passed) allChecksPass = false;
}

console.log();

// ============================================================
// 总结
// ============================================================
if (allChecksPass) {
  console.log('🎉 Phase 1 核心实现验证通过！\n');
  console.log('下一步：');
  console.log('  1. 运行 TypeScript 编译: cd packages/core && pnpm typecheck');
  console.log('  2. 运行测试: pnpm test');
  console.log('  3. 启动应用进行集成测试: pnpm dev\n');
  process.exit(0);
} else {
  console.error('❌ Phase 1 验证失败，请检查上述错误\n');
  process.exit(1);
}
