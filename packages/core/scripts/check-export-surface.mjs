#!/usr/bin/env node
// ============================================================
// Export Surface Monitor Script
// Monitors index.ts export count to prevent bloat
// ============================================================

import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX_PATH = join(import.meta.dirname, '..', 'src', 'index.ts');
const MAX_EXPORTS = 80;

const content = readFileSync(INDEX_PATH, 'utf-8');

// Count export statements (export { ... }, export type { ... }, export function/class/const/etc)
const exportMatches = content.match(/^export\s+(?:type\s+)?(?:default\s+)?(?:function|class|const|let|var|interface|enum|\{|[*])/gm) || [];
const exportCount = exportMatches.length;

console.log('=== Export Surface Monitor ===\n');
console.log(`File: src/index.ts`);
console.log(`Exports: ${exportCount} / ${MAX_EXPORTS}`);

if (exportCount > MAX_EXPORTS) {
  console.log(`\n❌ Export surface exceeds limit: ${exportCount} > ${MAX_EXPORTS}`);
  process.exit(1);
} else {
  console.log(`\n✅ Export surface is within limit.`);
  process.exit(0);
}
