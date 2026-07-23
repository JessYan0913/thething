#!/usr/bin/env node
/**
 * 验证 Phase 1-3 集成是否完整
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

console.log('🔍 验证 Phase 1-3 集成...\n');

const checks = [
  {
    name: 'compaction-view.ts',
    path: 'packages/core/src/modules/compaction/compaction-view.ts',
    patterns: [
      'import type { CompactionTelemetry }',
      'telemetry?: CompactionTelemetry',
      'createCompactionView(telemetry?: CompactionTelemetry)',
      'view.telemetry?.recordViewApplied',
      'view.telemetry?.recordViewInvalidated',
    ],
  },
  {
    name: 'compaction-telemetry.ts',
    path: 'packages/core/src/modules/compaction/compaction-telemetry.ts',
    patterns: [
      'export class CompactionTelemetry',
      'recordViewApplied',
      'recordViewInvalidated',
      'recordLayer3Triggered',
      'getStats',
      'generateReport',
    ],
  },
  {
    name: 'compaction/index.ts',
    path: 'packages/core/src/modules/compaction/index.ts',
    patterns: [
      'import type { CompactionTelemetry }',
      'telemetry?: CompactionTelemetry',
      'context.telemetry?.recordLayer3Triggered',
    ],
  },
  {
    name: 'session/types.ts',
    path: 'packages/core/src/modules/session/types.ts',
    patterns: [
      "telemetry: import('../compaction/compaction-telemetry').CompactionTelemetry",
    ],
  },
  {
    name: 'session/state.ts',
    path: 'packages/core/src/modules/session/state.ts',
    patterns: [
      'import { CompactionTelemetry }',
      'new CompactionTelemetry()',
      'createCompactionView(telemetry)',
      'telemetry: state.telemetry',
    ],
  },
];

let allPassed = true;

for (const check of checks) {
  const filePath = join(root, check.path);

  if (!existsSync(filePath)) {
    console.log(`❌ ${check.name}: 文件不存在`);
    allPassed = false;
    continue;
  }

  const content = readFileSync(filePath, 'utf-8');
  const missingPatterns = [];

  for (const pattern of check.patterns) {
    if (!content.includes(pattern)) {
      missingPatterns.push(pattern);
    }
  }

  if (missingPatterns.length === 0) {
    console.log(`✅ ${check.name}: 所有检查通过 (${check.patterns.length}/${check.patterns.length})`);
  } else {
    console.log(`❌ ${check.name}: 缺少 ${missingPatterns.length} 个模式`);
    for (const pattern of missingPatterns) {
      console.log(`   - ${pattern}`);
    }
    allPassed = false;
  }
}

console.log();

if (allPassed) {
  console.log('🎉 所有检查通过！Phase 1-3 集成完整。\n');
  console.log('📋 下一步：');
  console.log('  1. 启动应用：pnpm dev');
  console.log('  2. 发送消息');
  console.log('  3. 查看遥测数据（需要添加输出代码）');
  console.log();
  console.log('💡 添加遥测输出示例：');
  console.log('  在 session/state.ts 的 compact 方法中：');
  console.log('  if (state.turnCount % 3 === 0) {');
  console.log("    console.log('\\n' + state.telemetry.generateReport() + '\\n');");
  console.log('  }');
} else {
  console.log('⚠️  部分检查未通过，请检查上述错误。\n');
  process.exit(1);
}
