#!/usr/bin/env node
// ============================================================
// Interface Isolation Checker
// ============================================================
// 检查 SessionState 的消费者是否只 import 了需要的接口。

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC_DIR = join(import.meta.dirname, '..', 'packages', 'core', 'src');

// 定义每个模块应该使用的接口（不允许直接 import SessionState）
const RULES = [
  {
    name: 'compaction',
    dir: join(SRC_DIR, 'modules', 'compaction'),
    // Should use ToolOutputState, not SessionState
    forbidden: [/from\s+['"].*session\/state['"]/, /from\s+['"].*session\/types['"]/],
    allowed: [/from\s+['"].*session\/interfaces['"]/],
  },
  {
    name: 'agent-control/pipeline',
    dir: join(SRC_DIR, 'modules', 'agent-control'),
    // Should use session/types (type-only), not session/state (runtime)
    forbidden: [/from\s+['"].*session\/state['"]/],
    allowed: [/from\s+['"].*session\/types['"]/, /from\s+['"].*session\/interfaces['"]/],
  },
];

let violations = 0;

for (const rule of RULES) {
  const files = getAllTsFiles(rule.dir);
  for (const file of files) {
    if (file.includes('__tests__')) continue;
    const content = readFileSync(file, 'utf-8');

    for (const pattern of rule.forbidden) {
      if (pattern.test(content)) {
        const relFile = file.replace(SRC_DIR + '/', '');
        console.error(`VIOLATION [${rule.name}]: ${relFile} imports from forbidden path`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} interface isolation violation(s) found.`);
  process.exit(1);
} else {
  console.log(`✓ All modules pass interface isolation check.`);
}

// ============================================================
// Helpers
// ============================================================

import { readdirSync, statSync } from 'fs';

function getAllTsFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getAllTsFiles(fullPath));
      } else if (entry.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return files;
}
