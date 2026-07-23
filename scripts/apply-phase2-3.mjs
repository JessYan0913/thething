#!/usr/bin/env node
/**
 * 自动应用 Phase 2 & 3 集成补丁
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

console.log('🚀 开始应用 Phase 2 & 3 集成补丁...\n');

// ============================================================
// 1. compaction/index.ts - 添加 telemetry 支持
// ============================================================
console.log('📝 修改 packages/core/src/modules/compaction/index.ts...');

const indexPath = join(root, 'packages/core/src/modules/compaction/index.ts');
let indexContent = readFileSync(indexPath, 'utf-8');

// 添加 import
if (!indexContent.includes('CompactionTelemetry')) {
  indexContent = indexContent.replace(
    "import type { CompactionView } from './compaction-view';",
    `import type { CompactionView } from './compaction-view';
import type { CompactionTelemetry } from './compaction-telemetry';`
  );
  console.log('  ✅ 添加 CompactionTelemetry import');
} else {
  console.log('  ⏭️  CompactionTelemetry import 已存在');
}

// 添加 telemetry 参数
if (!indexContent.includes('telemetry?: CompactionTelemetry')) {
  indexContent = indexContent.replace(
    /compactionView\?: CompactionView;\s*\}/,
    `compactionView?: CompactionView;
    telemetry?: CompactionTelemetry;
  }`
  );
  console.log('  ✅ 添加 telemetry 参数到 compactBeforeStep');
} else {
  console.log('  ⏭️  telemetry 参数已存在');
}

// 添加 Layer 3 遥测
if (!indexContent.includes('recordLayer3Triggered')) {
  // 查找 Layer 3 成功的位置
  const layer3Pattern = /(if \(summaryResult\.success\) \{[\s\S]*?current = summaryResult\.messages;)/;
  if (layer3Pattern.test(indexContent)) {
    indexContent = indexContent.replace(
      /(logger\.debug\('Compaction', `View updated: anchorIndex=\$\{summaryResult\.anchorIndex\}`\);)/,
      `$1

    // 记录 Layer 3 遥测
    const reason = !context.compactionView?.summary ? 'no_view' : 'budget_exceeded';
    context.telemetry?.recordLayer3Triggered({
      reason,
      messagesBeforeCompaction: messages.length,
      messagesAfterCompaction: current.length,
      durationMs: 0, // TODO: 添加计时
    });`
    );
    console.log('  ✅ 添加 Layer 3 遥测记录');
  }
} else {
  console.log('  ⏭️  Layer 3 遥测已存在');
}

writeFileSync(indexPath, indexContent, 'utf-8');
console.log('  💾 保存完成\n');

// ============================================================
// 2. session/state.ts - 创建 telemetry 实例
// ============================================================
console.log('📝 修改 packages/core/src/modules/session/state.ts...');

const statePath = join(root, 'packages/core/src/modules/compaction/compaction-view.ts');
let stateContent = readFileSync(join(root, 'packages/core/src/modules/session/state.ts'), 'utf-8');

// 添加 import
if (!indexContent.includes('CompactionTelemetry')) {
  stateContent = stateContent.replace(
    "import { createCompactionView } from '../compaction/compaction-view';",
    `import { createCompactionView } from '../compaction/compaction-view';
import { CompactionTelemetry } from '../compaction/compaction-telemetry';`
  );
  console.log('  ✅ 添加 CompactionTelemetry import');
} else {
  console.log('  ⏭️  CompactionTelemetry import 已存在');
}

// 添加 telemetry 字段到 SessionState 接口
if (!stateContent.includes('telemetry: CompactionTelemetry')) {
  stateContent = stateContent.replace(
    /(export interface SessionState \{[\s\S]*?compactionView: CompactionView;)/,
    `$1
  telemetry: CompactionTelemetry;`
  );
  console.log('  ✅ 添加 telemetry 字段到 SessionState');
} else {
  console.log('  ⏭️  telemetry 字段已存在');
}

// 在 createSessionState 中创建实例
if (!stateContent.includes('new CompactionTelemetry()')) {
  stateContent = stateContent.replace(
    /compactionView: createCompactionView\(\),/,
    `telemetry: new CompactionTelemetry(),
    compactionView: createCompactionView(new CompactionTelemetry()),`
  );
  console.log('  ✅ 创建 telemetry 实例');
} else {
  console.log('  ⏭️  telemetry 实例已创建');
}

// 添加 telemetry 到 compact 方法
if (!stateContent.includes('telemetry: this.telemetry')) {
  stateContent = stateContent.replace(
    /(compactionView: this\.compactionView,)/,
    `$1
      telemetry: this.telemetry,`
  );
  console.log('  ✅ 传递 telemetry 到 compact 方法');
} else {
  console.log('  ⏭️  telemetry 传递已存在');
}

writeFileSync(join(root, 'packages/core/src/modules/session/state.ts'), stateContent, 'utf-8');
console.log('  💾 保存完成\n');

// ============================================================
// 3. checkpoint.ts - 添加 telemetry 记录
// ============================================================
console.log('📝 修改 packages/core/src/modules/compaction/checkpoint.ts...');

const checkpointPath = join(root, 'packages/core/src/modules/compaction/checkpoint.ts');
let checkpointContent = readFileSync(checkpointPath, 'utf-8');

// 添加 telemetry 参数
if (!checkpointContent.includes('telemetry?: CompactionTelemetry')) {
  checkpointContent = checkpointContent.replace(
    /(export function applyCheckpointOnLoad\([^)]*store: GlobalStore,)/,
    `$1
  telemetry?: import('./compaction-telemetry').CompactionTelemetry,`
  );
  console.log('  ✅ 添加 telemetry 参数');
} else {
  console.log('  ⏭️  telemetry 参数已存在');
}

// 添加成功加载的遥测
if (!checkpointContent.includes('recordCheckpointLoaded')) {
  checkpointContent = checkpointContent.replace(
    /(return \{[\s\S]*?applied: true,[\s\S]*?anchorIndex: index,[\s\S]*?summaryText: checkpoint\.summary,[\s\S]*?\};)/,
    `telemetry?.recordCheckpointLoaded({
      applied: true,
      anchorIndex: index,
      messagesSkipped: index,
    });

    $1`
  );

  // 添加未应用的遥测
  checkpointContent = checkpointContent.replace(
    /(return \{[\s\S]*?applied: false,[\s\S]*?messages,[\s\S]*?\};)/,
    `telemetry?.recordCheckpointLoaded({
      applied: false,
    });

    $1`
  );
  console.log('  ✅ 添加 checkpoint 加载遥测');
} else {
  console.log('  ⏭️  checkpoint 遥测已存在');
}

writeFileSync(checkpointPath, checkpointContent, 'utf-8');
console.log('  💾 保存完成\n');

console.log('🎉 Phase 2 & 3 集成补丁应用完成！\n');
console.log('📋 后续步骤：');
console.log('  1. 检查编译: cd packages/core && pnpm typecheck');
console.log('  2. 运行测试: pnpm test compaction');
console.log('  3. 启动应用: pnpm dev');
console.log('  4. 查看遥测: sessionState.telemetry.generateReport()');
