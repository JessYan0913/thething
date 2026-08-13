// ============================================================
// Doctor Repairs — 修复注册表
// ============================================================
// safety: 'safe' 无需确认直接执行；'destructive' 需 confirmed:true。

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SqliteDatabase } from '../../primitives/datastore/types';
import { cleanupOldToolResults } from '../budget/tool-result-storage';
import { rebuildIndex } from '../wiki/wiki-io';
import { DEFAULT_WIKI_CONFIG } from '../wiki/wiki-config';
import type { DoctorContext, RepairDef, RepairOutcome } from './types';
import { CONVERSATION_SCOPED_TABLES, wikiPath } from './checks';

const execFileP = promisify(execFile);

function done(message: string, detail?: Record<string, unknown>): RepairOutcome {
  return { status: 'done', message, detail };
}

function errRepair(message: string): RepairOutcome {
  return { status: 'error', message };
}

/** 打开可写连接执行 fn（修复需要写库），关闭后返回结果。 */
async function withRwChatDb<T>(ctx: DoctorContext, fn: (db: SqliteDatabase) => T): Promise<RepairOutcome> {
  let db: SqliteDatabase | null = null;
  try {
    db = ctx.openDb(path.join(ctx.layout.dataDir, ctx.layout.filenames.db), { fileMustExist: true });
    return done(String(await fn(db)));
  } catch (e) {
    return errRepair(e instanceof Error ? e.message : String(e));
  } finally {
    db?.close();
  }
}

export const REPAIRS: readonly RepairDef[] = [
  {
    id: 'wal-checkpoint',
    title: 'WAL checkpoint',
    category: 'database',
    safety: 'safe',
    apply: (ctx) =>
      withRwChatDb(ctx, (db) => {
        db.pragma('busy_timeout = 10000');
        db.pragma('wal_checkpoint(TRUNCATE)');
        return 'WAL checkpoint 完成';
      }),
  },
  {
    id: 'vacuum-chat-db',
    title: 'chat.db VACUUM',
    category: 'database',
    safety: 'safe',
    apply: (ctx) =>
      withRwChatDb(ctx, (db) => {
        db.pragma('busy_timeout = 10000');
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.exec('VACUUM');
        const size = fs.stat(path.join(ctx.layout.dataDir, ctx.layout.filenames.db));
        return size.then((s) => `VACUUM 完成，DB ${s.size} 字节`);
      }).then((r) => (r.status === 'error' ? errRepair(`VACUUM 失败（数据库被占用？）：${r.message}。请稍后重试或用 CLI 在应用停止时执行`) : r)),
  },
  {
    id: 'prune-conversations',
    title: '清理孤儿消息 / 瞬态 part',
    category: 'database',
    safety: 'safe',
    apply: (ctx) => {
      if (!ctx.dataStore) return errRepair('缺少 dataStore（诊断模式下不可修复，请用 --fix 或在应用内触发）');
      const conversations = ctx.dataStore.conversationStore.listConversations();
      let affected = 0;
      let deletedOrphans = 0;
      let strippedMessages = 0;
      for (const conversation of conversations) {
        const preview = ctx.dataStore.messageStore.analyzePrune(conversation.id);
        if (preview.deletedOrphans > 0 || preview.strippedMessages > 0) {
          const applied = ctx.dataStore.messageStore.pruneConversation(conversation.id);
          affected++;
          deletedOrphans += applied.deletedOrphans;
          strippedMessages += applied.strippedMessages;
        }
      }
      return done(`已清理 ${affected} 个会话：删除 ${deletedOrphans} 条孤儿、剥离 ${strippedMessages} 条瞬态 part`, {
        affected,
        deletedOrphans,
        strippedMessages,
      });
    },
  },
  {
    id: 'cleanup-expired-suspended',
    title: '清理过期挂起状态',
    category: 'database',
    safety: 'safe',
    apply: (ctx) => {
      if (!ctx.dataStore) return errRepair('缺少 dataStore（诊断模式下不可修复）');
      const n = ctx.dataStore.suspendedStateStore.cleanupExpiredStates();
      return done(`已清理 ${n} 个过期挂起状态`, { cleaned: n });
    },
  },
  {
    id: 'cleanup-tool-results',
    title: '清理旧 tool-results',
    category: 'database',
    safety: 'safe',
    apply: async (ctx) => {
      const { cleanedSessions, cleanedFiles } = await cleanupOldToolResults(ctx.layout.dataDir, 7);
      return done(`已清理 ${cleanedSessions} 个会话、${cleanedFiles} 个文件`, { cleanedSessions, cleanedFiles });
    },
  },
  {
    id: 'delete-orphan-rows',
    title: '删除无主 conversation 行',
    category: 'database',
    safety: 'destructive',
    apply: (ctx, { confirmed }) => {
      if (!confirmed) {
        return { status: 'needs-confirmation', message: '将永久删除所有无主 conversation 行（不可恢复），确认？' };
      }
      return withRwChatDb(ctx, (db) => {
        db.pragma('busy_timeout = 10000');
        let total = 0;
        for (const table of CONVERSATION_SCOPED_TABLES) {
          try {
            const result = db
              .prepare(`DELETE FROM "${table}" WHERE conversation_id NOT IN (SELECT id FROM conversations)`)
              .run();
            total += result.changes;
          } catch { /* 表不存在（旧库）则跳过 */ }
        }
        return `已删除 ${total} 个无主行`;
      });
    },
  },
  {
    id: 'delete-backup-files',
    title: '删除残留 DB 备份',
    category: 'database',
    safety: 'destructive',
    apply: async (ctx, { confirmed }) => {
      const dataDir = ctx.layout.dataDir;
      const entries = await fs.readdir(dataDir).catch(() => []);
      const backups = entries.filter((e) => e.startsWith('chat.db.backup-'));
      if (backups.length === 0) return done('无残留备份');
      let total = 0;
      for (const name of backups) {
        const st = await fs.stat(path.join(dataDir, name)).catch(() => null);
        if (st) total += st.size;
      }
      if (!confirmed) {
        return {
          status: 'needs-confirmation',
          message: `将永久删除 ${backups.length} 个备份（共 ${total} 字节），不可恢复，确认？`,
        };
      }
      // 先 checkpoint，避免当前 WAL 目标被误判为备份残留
      await withRwChatDb(ctx, (db) => {
        db.pragma('busy_timeout = 10000');
        db.pragma('wal_checkpoint(TRUNCATE)');
        return '';
      });
      let removed = 0;
      for (const name of backups) {
        await fs.rm(path.join(dataDir, name), { force: true });
        removed++;
      }
      return done(`已删除 ${removed} 个备份`, { removed });
    },
  },
  {
    id: 'chmod-mcp-auth',
    title: '修正 mcp-auth 权限',
    category: 'data-dir',
    safety: 'safe',
    apply: async (ctx) => {
      const dir = path.join(ctx.layout.dataDir, 'mcp-auth');
      const entries = await fs.readdir(dir).catch(() => []);
      let n = 0;
      for (const name of entries) {
        await fs.chmod(path.join(dir, name), 0o600);
        n++;
      }
      return done(`已 chmod 0600 ${n} 个文件`, { chmodded: n });
    },
  },
  {
    id: 'rebuild-wiki-index',
    title: '重建 wiki index.md',
    category: 'wiki',
    safety: 'safe',
    apply: async (ctx) => {
      const dir = wikiPath(ctx);
      if (!dir) return errRepair('无 wiki 目录');
      await rebuildIndex(dir, DEFAULT_WIKI_CONFIG);
      return done('wiki index.md 已重建');
    },
  },
  {
    id: 'remove-wiki-tmp',
    title: '删除 wiki 临时文件',
    category: 'wiki',
    safety: 'safe',
    apply: async (ctx) => {
      const dir = wikiPath(ctx);
      if (!dir) return errRepair('无 wiki 目录');
      let removed = 0;
      async function walk(d: string): Promise<void> {
        const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const p = path.join(d, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === '.git') continue;
            await walk(p);
          } else if (entry.isFile() && /\.tmp-[0-9a-f]+$/.test(entry.name)) {
            await fs.rm(p, { force: true });
            removed++;
          }
        }
      }
      await walk(dir);
      return done(`已删除 ${removed} 个临时文件`, { removed });
    },
  },
  {
    id: 'wiki-git-gc',
    title: 'wiki git gc',
    category: 'wiki',
    safety: 'safe',
    apply: async (ctx) => {
      const dir = wikiPath(ctx);
      if (!dir) return errRepair('无 wiki 目录');
      await execFileP('git', ['-C', dir, 'gc', '--prune=now']);
      return done('wiki git gc 完成');
    },
  },
];

/** 按 id 派发修复；未知 id → error。 */
export async function applyRepair(
  ctx: DoctorContext,
  repairId: string,
  opts: { confirmed: boolean },
): Promise<RepairOutcome> {
  const repair = REPAIRS.find((r) => r.id === repairId);
  if (!repair) return errRepair(`未知修复：${repairId}`);
  return repair.apply(ctx, opts);
}
