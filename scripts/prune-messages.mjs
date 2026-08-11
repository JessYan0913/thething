#!/usr/bin/env node
// ============================================================
// 全库一次性清理：剥离瞬态 data-* part + 删除孤儿分支消息 + VACUUM
// ============================================================
// 背景：瞬态 UI part（data-todo-update / data-bash-output / data-context-usage /
// data-compaction-status）被历史版本持久化，且 regenerate/编辑产生的不可达分支
// 无限累积，导致 chat.db 膨胀（实测 2298 条消息 / 340MB，其中约 300MB 是垃圾）。
//
// 幂等设计：剥离已剥离的消息是 no-op；孤儿删除后可达集不变；可安全重复执行。
// 回滚：备份文件 chat.db.backup-<timestamp>（默认保留）。
//
// 用法：
//   node scripts/prune-messages.mjs            # 默认清理 ~/.thething/data/chat.db
//   node scripts/prune-messages.mjs --db /path/to/chat.db
//   node scripts/prune-messages.mjs --dry-run  # 只统计不写库
//   node scripts/prune-messages.mjs --no-backup
// ============================================================

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const coreRequire = createRequire(
  path.join(import.meta.dirname, '..', 'packages', 'core', 'package.json'),
);
const Database = coreRequire('better-sqlite3');

// 与 core message-store 的 TRANSIENT_PART_TYPES 保持一致（剥离范围需同步维护）
const TRANSIENT_PART_TYPES = new Set([
  'data-todo-update',
  'data-bash-output',
  'data-context-usage',
  'data-compaction-status',
]);

// ── 参数 ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dbPath = args.find((a, i) => args[i - 1] === '--db') ?? path.join(os.homedir(), '.thething', 'data', 'chat.db');
const dryRun = args.includes('--dry-run');
const noBackup = args.includes('--no-backup');

if (!fs.existsSync(dbPath)) {
  console.error(`❌ 未找到数据库: ${dbPath}`);
  process.exit(1);
}

const dbSize = () => fs.statSync(dbPath).size;

console.log('🧹 开始清理膨胀数据');
console.log(`  DB: ${dbPath}`);
console.log(`  当前大小: ${(dbSize() / 1024 / 1024).toFixed(1)} MB`);
if (dryRun) console.log('  模式: dry-run（只统计不写库）');
console.log('');

// ── 1. WAL checkpoint + 备份 ─────────────────────────────────
// 先强制 WAL 合并进主文件，确保复制出的备份包含全部数据（WAL 模式下
// 主文件单独复制会缺失未 checkpoint 的数据）。
let backupPath = null;
if (!dryRun) {
  const checkpointDb = new Database(dbPath);
  try { checkpointDb.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  checkpointDb.close();
  if (!noBackup) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${dbPath}.backup-${timestamp}`;
    fs.copyFileSync(dbPath, backupPath);
    console.log(`📦 已备份: ${backupPath}`);
  }
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');

// ── 2. 剥离瞬态 part + 3. 清孤儿 ─────────────────────────────
let totalStripped = 0;
let totalStrippedBytes = 0;
let totalOrphans = 0;
let totalConvs = 0;

const conversations = db.prepare('SELECT id FROM conversations').all();
const updateContent = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
const delMsg = db.prepare('DELETE FROM messages WHERE id = ?');
const delSel = db.prepare(
  'DELETE FROM conversation_branch_selections WHERE conversation_id = ? AND (parent_message_id = ? OR selected_child_id = ?)',
);

for (const conv of conversations) {
  const cid = conv.id;
  let stripped = 0;
  let strippedBytes = 0;

  // 3. 先算可达集并删孤儿：可达集 = head + 所有 branch tip 沿 parent 回溯，
  //    其余是 regenerate/编辑丢弃的历史版本，删除（避免对即将删除的消息白做工剥离）。
  const allRows = db
    .prepare('SELECT id, parent_id FROM messages WHERE conversation_id = ?')
    .all(cid);
  const byId = new Map(allRows.map((r) => [r.id, r.parent_id]));

  const reachable = new Set();
  const tips = new Set();
  const headRow = db.prepare('SELECT head_message_id FROM conversations WHERE id = ?').get(cid);
  if (headRow?.head_message_id) tips.add(headRow.head_message_id);
  const branchTips = db
    .prepare('SELECT tip_message_id FROM conversation_branches WHERE conversation_id = ?')
    .all(cid);
  for (const b of branchTips) if (b.tip_message_id) tips.add(b.tip_message_id);

  for (const tip of tips) {
    let cursor = tip;
    while (cursor && !reachable.has(cursor)) {
      reachable.add(cursor);
      cursor = byId.get(cursor) ?? null;
    }
  }

  const orphanIds = allRows.map((r) => r.id).filter((id) => !reachable.has(id));
  if (!dryRun) {
    for (const id of orphanIds) delMsg.run(id);
    for (const id of orphanIds) delSel.run(cid, id, id);
  }

  // 2. 再剥离剩余（可达）消息中的瞬态 part
  const rows = db.prepare('SELECT id, content FROM messages WHERE conversation_id = ?').all(cid);
  for (const row of rows) {
    try {
      const message = JSON.parse(row.content);
      const parts = Array.isArray(message.parts)
        ? message.parts.filter((p) => !TRANSIENT_PART_TYPES.has(p?.type))
        : message.parts;
      if (Array.isArray(message.parts) && parts.length !== message.parts.length) {
        const newContent = JSON.stringify({ ...message, parts });
        if (!dryRun) updateContent.run(newContent, row.id);
        stripped++;
        strippedBytes += Math.max(0, row.content.length - newContent.length);
      }
    } catch { /* malformed content, skip */ }
  }

  if (stripped > 0 || orphanIds.length > 0) {
    totalConvs++;
    totalStripped += stripped;
    totalStrippedBytes += strippedBytes;
    totalOrphans += orphanIds.length;
    if (!dryRun) {
      db.prepare('UPDATE conversations SET revision = revision + 1 WHERE id = ?').run(cid);
    }
    console.log(
      `  [${cid.slice(0, 12)}…] 剥离 ${stripped} 条 / ${(strippedBytes / 1024).toFixed(0)}KB，孤儿 ${orphanIds.length} 条`,
    );
  }
}

// ── 4. VACUUM ────────────────────────────────────────────────
const before = dbSize();
if (!dryRun) {
  console.log('\n🗜️  执行 VACUUM 回收磁盘…');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
}

const after = dbSize();
db.close();

// ── 统计 ─────────────────────────────────────────────────────
console.log('\n✅ 清理完成');
console.log(`  涉及会话: ${totalConvs}`);
console.log(`  剥离瞬态 part: ${totalStripped} 条消息`);
console.log(`  释放字节(剥离): ${(totalStrippedBytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  删除孤儿消息: ${totalOrphans} 条`);
console.log(`  DB 大小: ${(before / 1024 / 1024).toFixed(1)} MB → ${(after / 1024 / 1024).toFixed(1)} MB`);
if (backupPath) console.log(`  备份保留在: ${backupPath}`);
if (dryRun) console.log('  （dry-run：未写入任何改动）');
