#!/usr/bin/env node
// ============================================================
// Layer Dependency Direction Checker
// ============================================================
// 验证依赖方向只能是: primitives → services → modules → composition
// 任何反向依赖即失败。

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

const SRC_DIR = join(import.meta.dirname, '..', 'packages', 'core', 'src');

const LAYER_MAP = {
  primitives: 1,
  services: 2,
  modules: 3,
  composition: 4,
};

function getLayer(filePath) {
  const rel = relative(SRC_DIR, filePath);
  const topDir = rel.split('/')[0];
  return LAYER_MAP[topDir] ?? null;
}

function getAllTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractImports(content) {
  const imports = [];
  const lines = content.split('\n');
  let inTypeOnlyExport = false;
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip type-only imports (no runtime dependency)
    if (trimmed.startsWith('import type ') || trimmed.startsWith('import { type')) continue;

    // Track multi-line export type blocks
    if (trimmed.startsWith('export type ')) {
      inTypeOnlyExport = true;
      // Single-line export type: export type { X } from '...'
      if (trimmed.includes(' from ')) {
        inTypeOnlyExport = false;
        continue;
      }
    }
    if (inTypeOnlyExport) {
      if (trimmed.includes(' from ')) {
        inTypeOnlyExport = false;
        continue;
      }
      if (trimmed === '}') {
        inTypeOnlyExport = false;
        continue;
      }
      continue;
    }

    const regex = /from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(trimmed)) !== null) {
      const importPath = match[1];
      // Only process relative imports
      if (importPath.startsWith('.')) {
        imports.push(importPath);
      }
    }
  }
  return imports;
}

function resolveImport(fromFile, importPath) {
  const fromDir = dirname(fromFile);
  const resolved = join(fromDir, importPath);
  // Try .ts extension
  if (statSync(resolved + '.ts').isFile()) return resolved + '.ts';
  if (statSync(join(resolved, 'index.ts')).isFile()) return join(resolved, 'index.ts');
  return resolved;
}

// ============================================================
// Main
// ============================================================

const files = getAllTsFiles(SRC_DIR);
let violations = 0;

for (const file of files) {
  const fileLayer = getLayer(file);
  if (fileLayer === null) continue;

  const content = readFileSync(file, 'utf-8');
  const imports = extractImports(content);

  for (const importPath of imports) {
    try {
      const resolved = resolveImport(file, importPath);
      const importLayer = getLayer(resolved);
      if (importLayer === null) continue;

      if (importLayer > fileLayer) {
        const relFile = relative(SRC_DIR, file);
        const relImport = relative(SRC_DIR, resolved);
        console.error(`VIOLATION: ${relFile} (L${fileLayer}) → ${relImport} (L${importLayer})`);
        violations++;
      }
    } catch {
      // File doesn't exist (maybe external package), skip
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} layer dependency violation(s) found.`);
  process.exit(1);
} else {
  console.log(`✓ All ${files.length} files pass layer dependency check.`);
}
