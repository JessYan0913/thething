#!/usr/bin/env node
// ============================================================
// Export Surface Monitor
// ============================================================
// 监控 index.ts 的导出数量，防止无限膨胀。

import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX_FILE = join(import.meta.dirname, '..', 'packages', 'core', 'src', 'index.ts');
const MAX_EXPORTS = 50;

const content = readFileSync(INDEX_FILE, 'utf-8');

// Count export lines (export { ... }, export type { ... }, export function/class/const/etc)
const exportLines = content.split('\n').filter(line => {
  const trimmed = line.trim();
  return trimmed.startsWith('export ') && !trimmed.startsWith('//');
});

const count = exportLines.length;

if (count > MAX_EXPORTS) {
  console.error(`Export surface: ${count} > ${MAX_EXPORTS} (limit)`);
  process.exit(1);
} else {
  console.log(`✓ Export surface: ${count} / ${MAX_EXPORTS}`);
}
