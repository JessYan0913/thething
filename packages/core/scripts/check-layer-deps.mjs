#!/usr/bin/env node
// ============================================================
// Layer Dependency Check Script
// Verifies that dependency direction is: primitives -> services -> modules -> composition
// ============================================================

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(import.meta.dirname, '..', 'src');

// Layer definitions
const LAYER_MAP = {
  'primitives': 1,
  'services': 2,
  'modules': 3,
  'composition': 4,
};

// Get layer from file path
function getLayer(filePath) {
  const rel = relative(SRC, filePath);
  for (const [layer, _] of Object.entries(LAYER_MAP)) {
    if (rel.startsWith(layer + '/')) return layer;
  }
  return null; // root files (index.ts, etc.)
}

// Get layer number
function getLayerNum(layer) {
  return layer ? LAYER_MAP[layer] : 0;
}

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

// Extract imports from file content
function extractImports(content) {
  const imports = [];
  // Match import ... from '...' and import('...')
  const importRegex = /(?:import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]+\}|\w+))*\s+from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\))/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const path = match[1] || match[2];
    if (path && path.startsWith('.')) {
      imports.push(path);
    }
  }
  return imports;
}

// Resolve import path to absolute
function resolveImport(filePath, importPath) {
  const dir = join(filePath, '..');
  const resolved = join(dir, importPath);
  // Try adding .ts extension
  const candidates = [resolved, resolved + '.ts', join(resolved, 'index.ts')];
  for (const candidate of candidates) {
    try {
      statSync(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

// Main check
function checkLayerDeps() {
  const files = findTsFiles(SRC);
  const violations = [];

  for (const file of files) {
    const fileLayer = getLayer(file);
    const fileLayerNum = getLayerNum(fileLayer);

    if (!fileLayer) continue; // skip root files

    const content = readFileSync(file, 'utf-8');
    const imports = extractImports(content);

    for (const importPath of imports) {
      const resolved = resolveImport(file, importPath);
      if (!resolved) continue;

      const importLayer = getLayer(resolved);
      const importLayerNum = getLayerNum(importLayer);

      if (!importLayer) continue; // skip root imports

      // Check: can only import from same or lower layer
      if (importLayerNum > fileLayerNum) {
        violations.push({
          file: relative(SRC, file),
          layer: fileLayer,
          imports: importPath,
          importLayer: importLayer,
        });
      }
    }
  }

  return violations;
}

// Run
console.log('=== Layer Dependency Check ===\n');

const violations = checkLayerDeps();

if (violations.length === 0) {
  console.log('✅ No layer dependency violations found.');
  process.exit(0);
} else {
  console.log(`❌ Found ${violations.length} layer dependency violations:\n`);
  for (const v of violations) {
    console.log(`  ${v.file} (${v.layer}) imports ${v.imports} (${v.importLayer})`);
  }
  process.exit(1);
}
