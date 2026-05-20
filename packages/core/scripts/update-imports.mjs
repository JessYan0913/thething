#!/usr/bin/env node
// ============================================================
// Import Path Updater - 更新所有 import 路径以匹配新目录结构
// ============================================================

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// 旧路径前缀 -> 新路径前缀的映射
const PATH_MAPPINGS = [
  // foundation -> primitives (纯类型/函数)
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

  // foundation -> services (有状态服务)
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
  ["'../../foundation/logger'", "'../../primitives/logger'"],

  // config -> services/config
  ["'../../config/'", "'../../services/config/'"],
  ["'../../../config/'", "'../../../services/config/'"],

  // runtime -> modules
  ["'../session-state'", "'../session'"],
  ["'../../session-state'", "'../../session'"],
  ["'../../../session-state'", "'../../../session'"],

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
  ["'../../../extensions/attachments/'", "'../../../modules/attachments/'"],

  // api -> composition
  ["'../../api/'", "'../../composition/'"],
  ["'../../../api/'", "'../../../composition/'"],

  // application -> composition/inbound-agent
  ["'../../application/'", "'../../composition/inbound-agent/'"],
  ["'../../../application/'", "'../../../composition/inbound-agent/'"],

  // bootstrap -> composition/bootstrap
  ["'../bootstrap'", "'../composition/bootstrap'"],
  ["'../../bootstrap'", "'../../composition/bootstrap'"],
];

// 递归查找 .ts 文件
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

// 处理单个文件
function updateImports(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  let changed = false;

  for (const [old, newPath] of PATH_MAPPINGS) {
    if (content.includes(old)) {
      content = content.replaceAll(old, newPath);
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(filePath, content);
    console.log(`Updated: ${filePath}`);
  }
}

// 查找所有 .ts 文件
const srcDir = join(process.cwd(), 'src');
const files = findTsFiles(srcDir);

console.log(`Found ${files.length} files to process`);

for (const file of files) {
  updateImports(file);
}

console.log('Done!');
