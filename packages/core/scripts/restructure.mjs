#!/usr/bin/env node
// ============================================================
// Directory Restructure Script
// Moves files from old structure to new structure and updates imports
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

const SRC = join(import.meta.dirname, '..', 'src');

// ============================================================
// 1. Define file movements
// ============================================================

const MOVES = [
  // Primitives (Layer 1)
  ['foundation/constants.ts', 'primitives/constants.ts'],
  ['foundation/parser', 'primitives/parser'],
  ['foundation/paths/compute.ts', 'primitives/paths/compute.ts'],
  ['foundation/paths/resolve.ts', 'primitives/paths/resolve.ts'],
  ['foundation/paths/index.ts', 'primitives/paths/index.ts'],
  ['foundation/clock', 'primitives/clock'],
  ['foundation/datastore/types.ts', 'primitives/datastore/types.ts'],
  ['foundation/logger.ts', 'primitives/logger.ts'],

  // Services (Layer 2)
  ['foundation/model', 'services/model'],
  ['foundation/datastore/sqlite', 'services/datastore/sqlite'],
  ['foundation/datastore/constants.ts', 'services/datastore/constants.ts'],
  ['foundation/datastore/index.ts', 'services/datastore/index.ts'],
  ['foundation/datastore/store.ts', 'services/datastore/store.ts'],
  ['foundation/scanner', 'services/scanner'],
  ['config', 'services/config'],

  // Modules (Layer 3) - runtime
  ['runtime/session-state', 'modules/session'],
  ['runtime/compaction', 'modules/compaction'],
  ['runtime/budget', 'modules/budget'],
  ['runtime/tasks', 'modules/tasks'],
  ['runtime/tools', 'modules/tools'],
  ['runtime/middleware', 'modules/middleware'],
  ['runtime/agent-control', 'modules/agent-control'],
  ['runtime/agent', 'modules/agent'],

  // Modules (Layer 3) - extensions
  ['extensions/skills', 'modules/skills'],
  ['extensions/mcp', 'modules/mcp'],
  ['extensions/connector', 'modules/connector'],
  ['extensions/subagents', 'modules/subagents'],
  ['extensions/memory', 'modules/memory'],
  ['extensions/permissions', 'modules/permissions'],
  ['extensions/system-prompt', 'modules/system-prompt'],
  ['extensions/attachments', 'modules/attachments'],

  // Composition (Layer 4)
  ['api/loaders', 'composition/loaders'],
  ['api/app', 'composition/app'],
  ['application/inbound-agent', 'composition/inbound-agent'],
  ['bootstrap.ts', 'composition/bootstrap.ts'],
];

// ============================================================
// 2. Create target directories
// ============================================================

function createDirectories() {
  const dirs = [
    'primitives', 'primitives/parser', 'primitives/paths', 'primitives/clock', 'primitives/datastore',
    'services', 'services/model', 'services/datastore', 'services/datastore/sqlite', 'services/config', 'services/scanner',
    'modules', 'modules/session', 'modules/compaction', 'modules/budget', 'modules/tasks', 'modules/tasks/task-tools',
    'modules/tools', 'modules/middleware', 'modules/agent-control', 'modules/agent', 'modules/agent/context',
    'modules/skills', 'modules/mcp', 'modules/connector', 'modules/connector/auth', 'modules/connector/credentials',
    'modules/connector/executors', 'modules/connector/inbound', 'modules/connector/inbound/adapters',
    'modules/connector/inbound/crypto', 'modules/connector/inbound/gateway', 'modules/connector/inbound/inbox',
    'modules/connector/inbound/responder',
    'modules/subagents', 'modules/subagents/built-in',
    'modules/memory', 'modules/permissions', 'modules/system-prompt', 'modules/system-prompt/sections',
    'modules/attachments',
    'composition', 'composition/loaders', 'composition/loaders/modules', 'composition/app', 'composition/inbound-agent',
  ];
  for (const dir of dirs) {
    mkdirSync(join(SRC, dir), { recursive: true });
  }
}

// ============================================================
// 3. Copy files
// ============================================================

function copyFiles() {
  for (const [src, dest] of MOVES) {
    const srcPath = join(SRC, src);
    const destPath = join(SRC, dest);
    if (existsSync(srcPath)) {
      cpSync(srcPath, destPath, { recursive: true });
      console.log(`Copied: ${src} -> ${dest}`);
    } else {
      console.log(`SKIP (not found): ${src}`);
    }
  }
}

// ============================================================
// 4. Update import paths
// ============================================================

const IMPORT_MAPPINGS = [
  // foundation -> primitives
  ["'../../foundation/constants'", "'../../primitives/constants'"],
  ["'../../../foundation/constants'", "'../../../primitives/constants'"],
  ["'../../../../foundation/constants'", "'../../../../primitives/constants'"],
  ["'../../foundation/parser'", "'../../primitives/parser'"],
  ["'../../../foundation/parser'", "'../../../primitives/parser'"],
  ["'../../foundation/parser/", "'../../primitives/parser/"],
  ["'../../../foundation/parser/", "'../../../primitives/parser/"],
  ["'../../foundation/paths'", "'../../primitives/paths'"],
  ["'../../../foundation/paths'", "'../../../primitives/paths'"],
  ["'../../foundation/paths/", "'../../primitives/paths/"],
  ["'../../../foundation/paths/", "'../../../primitives/paths/"],
  ["'../../foundation/clock'", "'../../primitives/clock'"],
  ["'../../../foundation/clock'", "'../../../primitives/clock'"],
  ["'../../foundation/logger'", "'../../primitives/logger'"],
  ["'../../../foundation/logger'", "'../../../primitives/logger'"],
  ["'./foundation/logger'", "'./primitives/logger'"],

  // foundation -> services
  ["'../../foundation/model'", "'../../services/model'"],
  ["'../../../foundation/model'", "'../../../services/model'"],
  ["'../../foundation/model/", "'../../services/model/"],
  ["'../../../foundation/model/", "'../../../services/model/"],
  ["'../../foundation/datastore'", "'../../services/datastore'"],
  ["'../../../foundation/datastore'", "'../../../services/datastore'"],
  ["'../../foundation/datastore/", "'../../services/datastore/"],
  ["'../../../foundation/datastore/", "'../../../services/datastore/"],
  ["'../../foundation/scanner'", "'../../services/scanner'"],
  ["'../../../foundation/scanner'", "'../../../services/scanner'"],
  ["'../../foundation/scanner/", "'../../services/scanner/"],
  ["'../../../foundation/scanner/", "'../../../services/scanner/"],
  ["'./foundation/datastore'", "'./services/datastore'"],
  ["'./foundation/model/", "'./services/model/"],

  // config -> services/config
  ["'../../config/'", "'../../services/config/'"],
  ["'../../../config/'", "'../../../services/config/'"],
  ["'./config/'", "'./services/config/'"],

  // runtime -> modules
  ["'../session-state'", "'../session'"],
  ["'../../session-state'", "'../../session'"],
  ["'../../../session-state'", "'../../../session'"],
  ["'../compaction/'", "'../compaction/'"],
  ["'../../compaction/'", "'../../compaction/'"],
  ["'../budget/'", "'../budget/'"],
  ["'../../budget/'", "'../../budget/'"],
  ["'../tasks/'", "'../tasks/'"],
  ["'../../tasks/'", "'../../tasks/'"],
  ["'../tools/'", "'../tools/'"],
  ["'../../tools/'", "'../../tools/'"],
  ["'../middleware/'", "'../middleware/'"],
  ["'../../middleware/'", "'../../middleware/'"],
  ["'../agent-control/'", "'../agent-control/'"],
  ["'../../agent-control/'", "'../../agent-control/'"],
  ["'../agent/'", "'../agent/'"],
  ["'../../agent/'", "'../../agent/'"],
  ["'./runtime/compaction/", "'./modules/compaction/"],

  // extensions -> modules
  ["'../../extensions/skills/'", "'../../modules/skills/'"],
  ["'../../../extensions/skills/'", "'../../../modules/skills/'"],
  ["'../../extensions/mcp/'", "'../../modules/mcp/'"],
  ["'../../../extensions/mcp/'", "'../../../modules/mcp/'"],
  ["'../../extensions/connector/'", "'../../modules/connector/'"],
  ["'../../../extensions/connector/'", "'../../../modules/connector/'"],
  ["'../../extensions/subagents/'", "'../../modules/subagents/'"],
  ["'../../../extensions/subagents/'", "'../../../modules/subagents/'"],
  ["'../../extensions/memory/'", "'../../modules/memory/'"],
  ["'../../../extensions/memory/'", "'../../../modules/memory/'"],
  ["'../../extensions/permissions/'", "'../../modules/permissions/'"],
  ["'../../../extensions/permissions/'", "'../../../modules/permissions/'"],
  ["'../../extensions/system-prompt/'", "'../../modules/system-prompt/'"],
  ["'../../../extensions/system-prompt/'", "'../../../modules/system-prompt/'"],
  ["'../../extensions/attachments/'", "'../../modules/attachments/'"],
  ["'../../../extensions/attachments/'", "'../../../modules/attachments/"],
  ["'./extensions/connector'", "'./modules/connector'"],
  ["'./extensions/connector/", "'./modules/connector/"],
  ["'./extensions/permissions/", "'./modules/permissions/"],
  ["'./extensions/memory'", "'./modules/memory'"],
  ["'./extensions/memory/", "'./modules/memory/"],
  ["'./extensions/skills/", "'./modules/skills/"],
  ["'./extensions/subagents/", "'./modules/subagents/"],
  ["'./extensions/mcp/", "'./modules/mcp/"],
  ["'./extensions/system-prompt/", "'./modules/system-prompt/"],
  ["'./extensions/attachments/", "'./modules/attachments/"],

  // api -> composition
  ["'../../api/'", "'../../composition/'"],
  ["'../../../api/'", "'../../../composition/'"],
  ["'../api/'", "'../composition/'"],
  ["'./api/'", "'./composition/'"],

  // application -> composition/inbound-agent
  ["'../../application/'", "'../../composition/inbound-agent/'"],
  ["'../../../application/'", "'../../../composition/inbound-agent/'"],
  ["'./application/'", "'./composition/inbound-agent/'"],

  // bootstrap -> composition/bootstrap
  ["'../bootstrap'", "'../composition/bootstrap'"],
  ["'../../bootstrap'", "'../../composition/bootstrap'"],
  ["'./bootstrap'", "'./composition/bootstrap'"],
];

function updateImportsInFile(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  let changed = false;

  for (const [old, newPath] of IMPORT_MAPPINGS) {
    if (content.includes(old)) {
      content = content.replaceAll(old, newPath);
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(filePath, content);
    return true;
  }
  return false;
}

// Recursively find .ts files
function findTsFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
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

function updateAllImports() {
  const files = findTsFiles(join(SRC, 'primitives'))
    .concat(findTsFiles(join(SRC, 'services')))
    .concat(findTsFiles(join(SRC, 'modules')))
    .concat(findTsFiles(join(SRC, 'composition')));

  let updated = 0;
  for (const file of files) {
    if (updateImportsInFile(file)) {
      updated++;
    }
  }
  console.log(`Updated imports in ${updated} files`);
}

// ============================================================
// 5. Update index.ts
// ============================================================

function updateIndexTs() {
  const indexPath = join(SRC, 'index.ts');
  if (!existsSync(indexPath)) return;

  let content = readFileSync(indexPath, 'utf-8');

  // Update import paths in index.ts
  for (const [old, newPath] of IMPORT_MAPPINGS) {
    content = content.replaceAll(old, newPath);
  }

  writeFileSync(indexPath, content);
  console.log('Updated index.ts');
}

// ============================================================
// 6. Delete old directories
// ============================================================

function deleteOldDirectories() {
  const oldDirs = ['foundation', 'config', 'runtime', 'extensions', 'api', 'application'];
  for (const dir of oldDirs) {
    const dirPath = join(SRC, dir);
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
      console.log(`Deleted: ${dir}/`);
    }
  }
}

// ============================================================
// Main
// ============================================================

console.log('=== Directory Restructure ===\n');

console.log('Step 1: Creating target directories...');
createDirectories();

console.log('\nStep 2: Copying files...');
copyFiles();

console.log('\nStep 3: Updating imports...');
updateAllImports();

console.log('\nStep 4: Updating index.ts...');
updateIndexTs();

console.log('\nStep 5: Deleting old directories...');
deleteOldDirectories();

console.log('\n=== Done! ===');
