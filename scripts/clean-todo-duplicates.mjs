#!/usr/bin/env node
// ============================================================
// 全库一次性清理：归并同一会话内标题重复的"活跃"todo
// ============================================================
// 背景：会话在中断/压缩/续做/regenerate 反复恢复时，checkpoint 摘要剥掉 todo 的 id，
// 模型用 todo_write 无 id 重建同标题任务（旧版本无去重），产生大量重复的
// pending/in_progress/failed 行，多个 in_progress 并列误导执行。
//
// 策略（保守，只动活跃重复项）：
//   - 对同一会话内按"规范化标题"（trim+折叠空白）分组的非取消 todo，
//     仅当组内存在 >=2 个活跃项（pending/in_progress/failed）时处理。
//   - 保留组内 created_at 最早的那条活跃项为"权威项"（canonical）。
//   - 其余活跃重复项标为 cancelled（软取消，保留记录与依赖完整性；不物理删除）。
//   - 已完成/已取消项不参与归并（属历史/已结清，重复属正常"曾做过又重开"）。
// 幂等：重复组归并后可安全重复执行（不再有活跃重复组）。回滚：备份 chat.db.backup-<ts>。
//
// 用法：
//   node scripts/clean-todo-duplicates.mjs             # 默认 ~/.thething/data/chat.db
//   node scripts/clean-todo-duplicates.mjs --db PATH
//   node scripts/clean-todo-duplicates.mjs --dry-run   # 只统计不写库
//   node scripts/clean-todo-duplicates.mjs --no-backup
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

// 与 todo-write-tool normalizeSubject 保持一致（trim + 折叠内部连续空白）
function normalizeSubject(subject) {
  return (subject || '').trim().replace(/\s+/g, ' ');
}

// ── 参数 ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dbPath =
  args.find((a, i) => args[i - 1] === '--db') ??
  path.join(os.homedir(), '.thething', 'data', 'chat.db');
const dryRun = args.includes('--dry-run');
const noBackup = args.includes('--no-backup');

if (!fs.existsSync(dbPath)) {
  console.error(`❌ 未找到数据库: ${dbPath}`);
  process.exit(1);
}

console.log('🧹 清理重复活跃 todo');
console.log(`  DB: ${dbPath}`);
if (dryRun) console.log('  模式: dry-run（只统计不写库）');
console.log('');

// ── WAL checkpoint + 备份 ─────────────────────────────────────
let backupPath = null;
if (!dryRun) {
  const checkpointDb = new Database(dbPath);
  try {
    checkpointDb.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
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

const convoTodos = db.prepare(`SELECT * FROM todos WHERE conversation_id = ? ORDER BY created_at`);
const updateStatus = db.prepare(
  `UPDATE todos SET status = 'cancelled', completed_at = ?, claimed_by = NULL, active_form = NULL, updated_at = ? WHERE id = ?`,
);
const getAllConversations = db.prepare('SELECT id FROM conversations');

const nowIso = new Date().toISOString();
let activeGroups = 0;
let kept = 0;
let cancelled = 0;
let affectedConvs = 0;

const conversations = getAllConversations.all();
for (const { id: convId } of conversations) {
  const todos = convoTodos.all(convId);

  // 按规范化标题分组（仅看非取消项中属于"活跃"的）
  const groups = new Map();
  for (const t of todos) {
    if (!['pending', 'in_progress', 'failed'].includes(t.status)) continue;
    const key = normalizeSubject(t.subject);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  // 仅处理组内存在 >=2 个活跃项的组
  const actionableGroups = [...groups.values()].filter((g) => g.length >= 2);
  if (actionableGroups.length === 0) continue;

  affectedConvs++;
  for (const group of actionableGroups) {
    activeGroups++;
    // created_at 字符串兼容 ISO / SQLite datetime；按字典序即可（同格式）
    group.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    const canonical = group[0];
    const excess = group.slice(1);
    kept++;

    for (const dup of excess) {
      cancelled++;
      console.log(
        `  [${dryRun ? 'DRY' : 'CANCEL'}] ${convId}  "${dup.subject}"  id=${dup.id} (${dup.status}, created=${dup.created_at}) -> ${canonical.id}`,
      );
      if (!dryRun) {
        updateStatus.run(nowIso, nowIso, dup.id);
      }
    }
  }
}

console.log('');
console.log('━━ 汇总 ━━');
console.log(`  影响的会话数: ${affectedConvs}`);
console.log(`  重复组数: ${activeGroups}`);
console.log(`  保留的权威项: ${kept}`);
console.log(`  标 cancelled 的重复项: ${cancelled}`);
if (dryRun) console.log('  dry-run 结束，未写库');
if (backupPath) console.log(`  备份在: ${backupPath}`);

db.close();
