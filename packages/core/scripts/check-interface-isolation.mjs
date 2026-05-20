#!/usr/bin/env node
// ============================================================
// Interface Isolation Check Script
// Checks that SessionState consumers only import needed interfaces
// ============================================================

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(import.meta.dirname, '..', 'src');

// Allowed interfaces per module
const ALLOWED_INTERFACES = {
  'modules/compaction': ['TokenBudget', 'ToolOutputState', 'SessionContext'],
  'modules/agent-control/stop-conditions': ['CostTracking', 'DenialTracking', 'SessionContext'],
  'modules/agent-control/pipeline': ['TokenBudget', 'CostTracking', 'DenialTracking', 'ModelSwitching', 'ToolOutputState', 'SessionContext', 'CompactionService'],
  'modules/tools': ['SessionContext', 'ToolOutputState'],
};

// Recursively find .ts files
function findTsFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '__tests__') {
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Get module prefix from file path
function getModulePrefix(filePath) {
  const rel = relative(SRC, filePath);
  // Try to match against allowed interfaces keys
  for (const prefix of Object.keys(ALLOWED_INTERFACES)) {
    if (rel.startsWith(prefix)) return prefix;
  }
  return null;
}

// Main check
function checkInterfaceIsolation() {
  const files = findTsFiles(SRC);
  const violations = [];

  for (const file of files) {
    const modulePrefix = getModulePrefix(file);
    if (!modulePrefix) continue;

    const allowed = ALLOWED_INTERFACES[modulePrefix];
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC, file);

    // Check for imports of full SessionState type
    // Pattern: import type { SessionState } from ... or import { SessionState } from ...
    const sessionStateImport = /import\s+(?:type\s+)?\{[^}]*SessionState[^}]*\}\s+from\s+['"][^'"]+['"]/;
    if (sessionStateImport.test(content)) {
      violations.push({
        file: rel,
        module: modulePrefix,
        issue: 'Imports full SessionState type',
        allowed: allowed.join(', '),
      });
    }
  }

  return violations;
}

// Run
console.log('=== Interface Isolation Check ===\n');

const violations = checkInterfaceIsolation();

if (violations.length === 0) {
  console.log('✅ No interface isolation violations found.');
  process.exit(0);
} else {
  console.log(`❌ Found ${violations.length} interface isolation violations:\n`);
  for (const v of violations) {
    console.log(`  ${v.file} (${v.module}): ${v.issue}`);
    console.log(`    Allowed interfaces: ${v.allowed}`);
  }
  process.exit(1);
}
