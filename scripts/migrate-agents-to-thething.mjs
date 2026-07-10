#!/usr/bin/env node
// ============================================================
// migrate-agents-to-thething.mjs
// 将 ~/.agents 下的配置数据迁移到 ~/.thething，并创建 ~/.agents → ~/.thething symlink
// ============================================================
//
// 用法：
//   node scripts/migrate-agents-to-thething.mjs [--dry-run]
//
// 迁移内容：
//   ~/.agents/skills/     → ~/.thething/skills/
//   ~/.agents/agents/     → ~/.thething/agents/
//   ~/.agents/tasks/      → ~/.thething/tasks/
//   ~/.agents/mcp.json    → ~/.thething/mcp.json
//   ~/.agents/models.json → ~/.thething/models.json
//   ~/.agents/system-prompt.md → ~/.thething/system-prompt.md
//   ~/.agents/AGENTS.md   → ~/.thething/AGENTS.md
//
// 冲突处理：~/.thething 中已存在的文件不会被覆盖

import { existsSync, lstatSync, readlinkSync, readdirSync, statSync } from 'fs';
import { copyFile, mkdir, readFile, symlink, unlink } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';

const DRY_RUN = process.argv.includes('--dry-run');
const HOME = homedir();
const AGENTS_DIR = join(HOME, '.agents');
const THETHING_DIR = join(HOME, '.thething');

// 需要迁移的文件/目录
const MIGRATE_ITEMS = [
  'skills',
  'agents',
  'tasks',
  'mcp.json',
  'models.json',
  'system-prompt.md',
  'AGENTS.md',
];

function log(msg) {
  console.log(DRY_RUN ? `[DRY-RUN] ${msg}` : msg);
}

function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
}

/**
 * 递归复制目录
 */
async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!existsSync(destPath)) {
        await copyDir(srcPath, destPath);
      } else {
        // 目标已存在，递归合并
        await copyDir(srcPath, destPath);
      }
    } else {
      if (!existsSync(destPath)) {
        log(`  📄 ${basename(srcPath)}`);
        if (!DRY_RUN) await copyFile(srcPath, destPath);
      } else {
        warn(`跳过已存在: ${basename(srcPath)}`);
      }
    }
  }
}

/**
 * 迁移单个文件或目录
 */
async function migrateItem(name) {
  const src = join(AGENTS_DIR, name);
  const dest = join(THETHING_DIR, name);

  if (!existsSync(src)) return;

  const stat = statSync(src);

  if (stat.isDirectory()) {
    if (existsSync(dest)) {
      warn(`目录已存在，合并: ${name}/`);
      if (!DRY_RUN) await copyDir(src, dest);
    } else {
      log(`📁 ${name}/`);
      if (!DRY_RUN) await copyDir(src, dest);
    }
  } else {
    // 文件
    if (existsSync(dest)) {
      warn(`文件已存在，跳过: ${name}`);
    } else {
      log(`📄 ${name}`);
      if (!DRY_RUN) await copyFile(src, dest);
    }
  }
}

async function main() {
  console.log('=== ~/.agents → ~/.thething 迁移工具 ===\n');

  // 1. 检查 ~/.agents 是否存在
  if (!existsSync(AGENTS_DIR)) {
    console.log('✅ ~/.agents 不存在，无需迁移');
    return;
  }

  // 2. 检查 ~/.agents 是否已经是 symlink
  if (lstatSync(AGENTS_DIR).isSymbolicLink()) {
    const target = readlinkSync(AGENTS_DIR);
    if (target === THETHING_DIR) {
      console.log('✅ ~/.agents → ~/.thething symlink 已存在，无需迁移');
    } else {
      console.log(`⚠️  ~/.agents → ${target}（指向其他位置）`);
      console.log('请手动处理此 symlink');
    }
    return;
  }

  // 3. 确保 ~/.thething 存在
  if (!existsSync(THETHING_DIR)) {
    log('📁 创建 ~/.thething/');
    if (!DRY_RUN) await mkdir(THETHING_DIR, { recursive: true });
  }

  // 4. 迁移文件/目录
  console.log('迁移文件:');
  for (const item of MIGRATE_ITEMS) {
    await migrateItem(item);
  }

  // 5. 创建 symlink
  console.log('\n创建 symlink:');
  log(`~/.agents → ~/.thething`);

  if (!DRY_RUN) {
    // 先删除 ~/.agents 目录
    // 使用 rm -rf 风格的递归删除
    await rmrf(AGENTS_DIR);
    // 创建 symlink
    await symlink(THETHING_DIR, AGENTS_DIR, 'dir');
  }

  console.log('\n✅ 迁移完成！');
  console.log('现在 ~/.agents 是指向 ~/.thething 的 symlink');
}

/**
 * 递归删除目录（Node.js 14+ 兼容）
 */
async function rmrf(dir) {
  const { rm } = await import('fs/promises');
  await rm(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('❌ 迁移失败:', err.message);
  process.exit(1);
});
