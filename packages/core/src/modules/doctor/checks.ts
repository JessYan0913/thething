// ============================================================
// Doctor Checks — 诊断检查注册表
// ============================================================
// 每项检查自查错、绝不 throw；只读操作（openDb 只读、fs、git status）。

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SqliteDatabase } from '../../primitives/datastore/types';
import { SCHEMA_VERSION } from '../../services/datastore/sqlite/schema';
import { analyzeConversationPrune } from '../../services/datastore/sqlite/message-store';
import { formatSize } from '../budget/tool-result-storage';
import { readIndex, scanPageFiles } from '../wiki/wiki-io';
import { lintDeterministic } from '../wiki/wiki-lint';
import { DEFAULT_WIKI_CONFIG } from '../wiki/wiki-config';
import type { CheckCategory, CheckDef, CheckResult, DoctorContext } from './types';

const execFileP = promisify(execFile);

type CheckMeta = Pick<CheckDef, 'id' | 'title' | 'category'>;

/** 构造检查：run 闭包拿到自己的 def（供状态助手用）。 */
function defineCheck(
  id: string,
  title: string,
  category: CheckCategory,
  run: (ctx: DoctorContext, def: CheckMeta) => Promise<CheckResult> | CheckResult,
): CheckDef {
  const def: CheckMeta = { id, title, category };
  return { ...def, run: (ctx) => run(ctx, def) };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function statIfExists(p: string) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

function chatDbPath(ctx: DoctorContext): string {
  return path.join(ctx.layout.dataDir, ctx.layout.filenames.db);
}

function okCheck(def: CheckMeta, message: string, data?: Record<string, unknown>): CheckResult {
  return { id: def.id, title: def.title, category: def.category, status: 'ok', message, data };
}

function warnCheck(def: CheckMeta, message: string, fixHint?: string): CheckResult {
  return { id: def.id, title: def.title, category: def.category, status: 'warn', message, fixHint };
}

function errCheck(def: CheckMeta, message: string): CheckResult {
  return { id: def.id, title: def.title, category: def.category, status: 'error', message };
}

/** 只读打开 chat.db 并执行 fn；文件缺失 {ok:false, reason:'missing'}；打开失败 {ok:false, reason:'error'}。 */
async function withChatDb<T>(
  ctx: DoctorContext,
  fn: (db: SqliteDatabase) => T | Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'missing' | 'error'; error?: string }> {
  if (!(await statIfExists(chatDbPath(ctx)))) return { ok: false, reason: 'missing' };
  let db: SqliteDatabase | null = null;
  try {
    db = ctx.openDb(chatDbPath(ctx), { readonly: true, fileMustExist: true });
    return { ok: true, value: await fn(db) };
  } catch (e) {
    return { ok: false, reason: 'error', error: errMsg(e) };
  } finally {
    db?.close();
  }
}

/** 只读打开任意 SQLite 文件并执行 fn；缺失/失败返回 {ok:false}。 */
async function withReadonlyDb<T>(
  ctx: DoctorContext,
  filePath: string,
  fn: (db: SqliteDatabase) => T | Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'missing' | 'error'; error?: string }> {
  if (!(await statIfExists(filePath))) return { ok: false, reason: 'missing' };
  let db: SqliteDatabase | null = null;
  try {
    db = ctx.openDb(filePath, { readonly: true, fileMustExist: true });
    return { ok: true, value: await fn(db) };
  } catch (e) {
    return { ok: false, reason: 'error', error: errMsg(e) };
  } finally {
    db?.close();
  }
}

function missingOrErr(def: CheckMeta, r: { ok: false; reason: 'missing' | 'error'; error?: string }, missingMsg: string): CheckResult {
  return r.reason === 'missing' ? okCheck(def, missingMsg) : errCheck(def, `无法打开：${r.error}`);
}

/** data 目录下递归大小（跳过符号链接与 .git）。 */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      total += await dirSize(p);
    } else if (entry.isFile()) {
      const st = await statIfExists(p);
      if (st) total += st.size;
    }
  }
  return total;
}

/** conversation 级表（含 conversation_id 列）。修复 delete-orphan-rows 复用。 */
export const CONVERSATION_SCOPED_TABLES = [
  'messages', 'messages_tree', 'summaries', 'todos', 'pending_approvals',
  'conversation_branches', 'conversation_branch_selections', 'conversation_runs',
  'agent_runs', 'stream_chunks', 'agent_status', 'suspended_agent_states', 'chat_costs',
  'message_text',
] as const;

/** wiki 目录（首个资源路径），不存在返回 null。 */
export function wikiPath(ctx: DoctorContext): string | null {
  const dir = ctx.layout.resources.wiki?.[0];
  return dir && dir.length > 0 ? dir : null;
}

export const CHECKS: readonly CheckDef[] = [
  defineCheck('chat-db-readable', 'chat.db 可读性', 'database', async (ctx, def) => {
    const r = await withChatDb(ctx, async (db) => {
      const row = db.prepare('SELECT count(*) AS c FROM conversations').get() as { c: number };
      const st = await fs.stat(chatDbPath(ctx));
      return { size: st.size, conversations: row.c };
    });
    if (!r.ok) return missingOrErr(def, r, 'chat.db 不存在（全新环境，无需诊断）');
    return okCheck(def, `可读，${formatSize(r.value.size)}，${r.value.conversations} 个会话`, {
      size: r.value.size,
      conversations: r.value.conversations,
    });
  }),

  defineCheck('chat-db-integrity', 'chat.db 完整性', 'database', async (ctx, def) => {
    const r = await withChatDb(ctx, (db) => (db.pragma('quick_check') as { quick_check?: string }[])[0]?.quick_check ?? 'no-result');
    if (!r.ok) return missingOrErr(def, r, '无 chat.db');
    if (r.value === 'ok') return okCheck(def, 'quick_check 通过');
    return errCheck(def, `quick_check 异常：${r.value}`);
  }),

  defineCheck('chat-db-schema-version', 'chat.db schema 版本', 'database', async (ctx, def) => {
    const r = await withChatDb(ctx, (db) => Number((db.pragma('user_version') as { user_version?: number }[])[0]?.user_version ?? 0));
    if (!r.ok) return missingOrErr(def, r, '无 chat.db');
    if (r.value === SCHEMA_VERSION) return okCheck(def, `schema v${SCHEMA_VERSION} 匹配`);
    return errCheck(def, `schema v${r.value} 与当前 v${SCHEMA_VERSION} 不一致（需运行应用触发迁移，doctor 只读不迁移）`);
  }),

  defineCheck('chat-db-wal-size', 'chat.db WAL 体积', 'database', async (ctx, def) => {
    const dbSt = await statIfExists(chatDbPath(ctx));
    if (!dbSt) return okCheck(def, '无 chat.db');
    const walSt = await statIfExists(`${chatDbPath(ctx)}-wal`);
    if (!walSt) return okCheck(def, '无 WAL 文件');
    if (walSt.size > dbSt.size / 3) {
      return warnCheck(def, `WAL ${formatSize(walSt.size)} vs DB ${formatSize(dbSt.size)}，建议 checkpoint`, 'wal-checkpoint');
    }
    return okCheck(def, `WAL ${formatSize(walSt.size)}（正常）`);
  }),

  defineCheck('chat-db-bloat', 'chat.db 页膨胀', 'database', async (ctx, def) => {
    const r = await withChatDb(ctx, (db) => {
      const page = Number((db.pragma('page_count') as { page_count?: number }[])[0]?.page_count ?? 0);
      const free = Number((db.pragma('freelist_count') as { freelist_count?: number }[])[0]?.freelist_count ?? 0);
      return { page, free };
    });
    if (!r.ok) return missingOrErr(def, r, '无 chat.db');
    const { page, free } = r.value;
    const ratio = page > 0 ? free / page : 0;
    if (ratio > 0.25) {
      return warnCheck(def, `空闲页 ${free}/${page}（${(ratio * 100).toFixed(0)}%），建议 VACUUM`, 'vacuum-chat-db');
    }
    return okCheck(def, page > 0 ? `空闲页 ${free}/${page}（正常）` : '空库');
  }),

  defineCheck('chat-db-orphans', '孤儿消息 / 瞬态 part', 'database', async (ctx, def) => {
    const r = await withChatDb(ctx, (db) => {
      const cids = db.prepare('SELECT id FROM conversations').all() as { id: string }[];
      let deletedOrphans = 0;
      let strippedMessages = 0;
      let affected = 0;
      for (const { id } of cids) {
        const s = analyzeConversationPrune(db, id);
        if (s.deletedOrphans > 0 || s.strippedMessages > 0) affected++;
        deletedOrphans += s.deletedOrphans;
        strippedMessages += s.strippedMessages;
      }
      return { total: cids.length, affected, deletedOrphans, strippedMessages };
    });
    if (!r.ok) return missingOrErr(def, r, '无 chat.db');
    const { total, affected, deletedOrphans, strippedMessages } = r.value;
    if (deletedOrphans > 0 || strippedMessages > 0) {
      return warnCheck(def, `${affected}/${total} 会话可清理：${deletedOrphans} 条孤儿、${strippedMessages} 条瞬态 part`, 'prune-conversations');
    }
    return okCheck(def, `${total} 个会话无孤儿 / 瞬态 part`);
  }),

  defineCheck('chat-db-orphan-rows', '无主 conversation 行', 'database', async (ctx, def) => {
    const r = await withChatDb(ctx, (db) => {
      const counts: Record<string, number> = {};
      for (const table of CONVERSATION_SCOPED_TABLES) {
        try {
          const row = db
            .prepare(`SELECT count(*) AS c FROM "${table}" t LEFT JOIN conversations c ON c.id = t.conversation_id WHERE c.id IS NULL`)
            .get() as { c: number };
          if (row.c > 0) counts[table] = row.c;
        } catch { /* 表不存在（旧库）则跳过 */ }
      }
      return counts;
    });
    if (!r.ok) return missingOrErr(def, r, '无 chat.db');
    const entries = Object.entries(r.value);
    if (entries.length === 0) return okCheck(def, '无无主行');
    return warnCheck(def, `无主行：${entries.map(([t, c]) => `${t} ${c}`).join('、')}`, 'delete-orphan-rows');
  }),

  defineCheck('chat-db-suspended-states', '过期挂起状态', 'database', async (ctx, def) => {
    // expires_at 存 ISO，需 datetime() 解析后比较（与 suspended-state-store 一致）
    const r = await withChatDb(ctx, (db) =>
      (db.prepare("SELECT count(*) AS c FROM suspended_agent_states WHERE datetime(expires_at) <= datetime('now')").get() as { c: number }).c);
    if (!r.ok) return missingOrErr(def, r, '无 chat.db');
    if (r.value > 0) return warnCheck(def, `${r.value} 个过期挂起状态`, 'cleanup-expired-suspended');
    return okCheck(def, '无过期挂起状态');
  }),

  defineCheck('tool-results-age', '旧 tool-results 会话', 'database', async (ctx, def) => {
    const dir = path.join(ctx.layout.dataDir, 'tool-results');
    const entries = await fs.readdir(dir).catch(() => []);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let old = 0;
    for (const name of entries) {
      const st = await statIfExists(path.join(dir, name));
      if (st?.isDirectory() && st.mtimeMs < cutoff) old++;
    }
    if (old > 0) return warnCheck(def, `${old} 个会话超过 7 天未访问`, 'cleanup-tool-results');
    return okCheck(def, entries.length > 0 ? `${entries.length} 个会话均新鲜` : '无 tool-results');
  }),

  defineCheck('chat-db-backups', '残留 DB 备份', 'database', async (ctx, def) => {
    const entries = await fs.readdir(ctx.layout.dataDir).catch(() => []);
    const backups = entries.filter((e) => e.startsWith('chat.db.backup-'));
    let total = 0;
    for (const name of backups) {
      const st = await statIfExists(path.join(ctx.layout.dataDir, name));
      if (st) total += st.size;
    }
    if (backups.length > 0) {
      return warnCheck(def, `残留 ${backups.length} 个备份（共 ${formatSize(total)}），如 ${backups[0]}`, 'delete-backup-files');
    }
    return okCheck(def, '无残留备份');
  }),

  defineCheck('data-dir-usage', 'data 目录占用', 'data-dir', async (ctx, def) => {
    const dataDir = ctx.layout.dataDir;
    const entries = await fs.readdir(dataDir, { withFileTypes: true }).catch(() => []);
    let total = 0;
    let big = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const size = await dirSize(path.join(dataDir, entry.name));
      total += size;
      if (size > 100 * 1024 * 1024) big++;
    }
    if (big > 0) return warnCheck(def, `data 目录下 ${big} 个子目录超过 100MB（子目录共 ${formatSize(total)}）`);
    return okCheck(def, `data 目录子目录共 ${formatSize(total)}`);
  }),

  defineCheck('memory-files-valid', 'memory 文件完整性', 'data-dir', async (ctx, def) => {
    const memoryDir = path.join(ctx.layout.configDir, 'memory');
    const entries = await fs.readdir(memoryDir).catch(() => []);
    const files = entries.filter((f) => f.endsWith('.md'));
    let invalid = 0;
    for (const file of files) {
      const raw = await fs.readFile(path.join(memoryDir, file), 'utf-8').catch(() => null);
      if (raw === null) { invalid++; continue; }
      const hasFrontmatter = /^---\n/.test(raw) && /^---\s*$/m.test(raw.slice(raw.indexOf('\n')));
      const hasId = /^id:\s*\S+/m.test(raw);
      if (!hasFrontmatter || !hasId) invalid++;
    }
    if (invalid > 0) return warnCheck(def, `${invalid}/${files.length} 个 memory 文件缺少 frontmatter/id`);
    return okCheck(def, files.length > 0 ? `${files.length} 个 memory 文件正常` : '无 memory 文件');
  }),

  defineCheck('mcp-json-valid', 'mcp.json 合法性', 'data-dir', async (ctx, def) => {
    const p = path.join(ctx.layout.configDir, 'mcp.json');
    const raw = await fs.readFile(p, 'utf-8').catch(() => null);
    if (raw === null) return okCheck(def, 'mcp.json 不存在');
    try {
      JSON.parse(raw);
      return okCheck(def, 'mcp.json 合法');
    } catch (e) {
      return errCheck(def, `mcp.json 非法 JSON：${errMsg(e)}（可用 .oauth-bak 恢复）`);
    }
  }),

  defineCheck('mcp-auth-permissions', 'mcp-auth 权限', 'data-dir', async (ctx, def) => {
    const dir = path.join(ctx.layout.dataDir, 'mcp-auth');
    const entries = await fs.readdir(dir).catch(() => []);
    let bad = 0;
    for (const name of entries) {
      const st = await statIfExists(path.join(dir, name));
      if (st && (st.mode & 0o077) !== 0) bad++;
    }
    if (bad > 0) return errCheck(def, `${bad} 个 mcp-auth 文件组/其他用户可读（须 0600）`);
    return okCheck(def, entries.length > 0 ? `${entries.length} 个 mcp-auth 文件权限正确` : '无 mcp-auth 文件');
  }),

  defineCheck('disk-free', '磁盘可用空间', 'data-dir', async (ctx, def) => {
    try {
      const s = await fs.statfs(ctx.layout.dataDir);
      const free = s.bavail * s.bsize;
      if (free < 500 * 1024 * 1024) return warnCheck(def, `可用空间不足：${formatSize(free)} < 500MB`);
      return okCheck(def, `可用 ${formatSize(free)}`);
    } catch {
      return okCheck(def, '无法读取磁盘空间');
    }
  }),

  defineCheck('wiki-git-status', 'wiki git 状态', 'wiki', async (ctx, def) => {
    const wikiDir = wikiPath(ctx);
    if (!wikiDir) return okCheck(def, '无 wiki 目录');
    const { stdout } = await execFileP('git', ['-C', wikiDir, 'status', '--porcelain']).catch(() => ({ stdout: '' }));
    const lines = stdout.split('\n').filter(Boolean);
    if (lines.length > 0) return warnCheck(def, `wiki 有 ${lines.length} 个未提交变更（${lines[0].slice(0, 60)}）`);
    return okCheck(def, 'wiki git 状态干净');
  }),

  defineCheck('wiki-index-drift', 'wiki 索引漂移', 'wiki', async (ctx, def) => {
    const wikiDir = wikiPath(ctx);
    if (!wikiDir) return okCheck(def, '无 wiki 目录');
    const files = await scanPageFiles(wikiDir, DEFAULT_WIKI_CONFIG);
    const index = await readIndex(wikiDir, DEFAULT_WIKI_CONFIG);
    const indexed = new Set(index.map((e) => e.filename));
    const missing = files.filter((f) => !indexed.has(f));
    if (missing.length > 0) return warnCheck(def, `index.md 缺失 ${missing.length} 个页面（如 ${missing[0]}）`, 'rebuild-wiki-index');
    return okCheck(def, 'index.md 与实际文件一致');
  }),

  defineCheck('wiki-lint-issues', 'wiki lint 问题', 'wiki', async (ctx, def) => {
    const wikiDir = wikiPath(ctx);
    if (!wikiDir) return okCheck(def, '无 wiki 目录');
    const issues = await lintDeterministic(wikiDir, DEFAULT_WIKI_CONFIG);
    if (issues.length > 0) {
      const kinds = [...new Set(issues.map((i) => i.type))].join(',');
      return warnCheck(def, `${issues.length} 个 lint 问题（${kinds}），索引类可自动重建`, 'rebuild-wiki-index');
    }
    return okCheck(def, '无 lint 问题');
  }),

  defineCheck('wiki-tmp-files', 'wiki 临时文件残留', 'wiki', async (ctx, def) => {
    const wikiDir = wikiPath(ctx);
    if (!wikiDir) return okCheck(def, '无 wiki 目录');
    const root = wikiDir;
    const leftovers: string[] = [];
    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '.git') continue;
          await walk(p);
        } else if (entry.isFile() && /\.tmp-[0-9a-f]+$/.test(entry.name)) {
          leftovers.push(path.relative(root, p));
        }
      }
    }
    await walk(wikiDir);
    if (leftovers.length > 0) return warnCheck(def, `${leftovers.length} 个 .tmp-* 残留（如 ${leftovers[0]}）`, 'remove-wiki-tmp');
    return okCheck(def, '无临时文件残留');
  }),

  defineCheck('wiki-git-gc', 'wiki git 松散对象', 'wiki', async (ctx, def) => {
    const wikiDir = wikiPath(ctx);
    if (!wikiDir) return okCheck(def, '无 wiki 目录');
    const { stdout } = await execFileP('git', ['-C', wikiDir, 'count-objects', '-v']).catch(() => ({ stdout: '' }));
    const count = Number(stdout.match(/^count: (\d+)/m)?.[1] ?? 0);
    const sizeKb = Number(stdout.match(/^size: (\d+)/m)?.[1] ?? 0);
    if (count > 100) return warnCheck(def, `${count} 个松散对象（${formatSize(sizeKb * 1024)}），建议 gc`, 'wiki-git-gc');
    return okCheck(def, `松散对象 ${count} 个（${formatSize(sizeKb * 1024)}）`);
  }),

  defineCheck('secondary-dbs-health', '次要数据库健康', 'secondary-db', async (ctx, def) => {
    const names = ['chat-streams.db', 'cron-jobs.db', 'connector-audit.db', 'connector-inbound-inbox.db'];
    const problems: string[] = [];
    const sizes: string[] = [];
    for (const name of names) {
      const p = path.join(ctx.layout.dataDir, name);
      const r = await withReadonlyDb(ctx, p, async (db) => {
        const integrity = (db.pragma('quick_check') as { quick_check?: string }[])[0]?.quick_check ?? 'no-result';
        const st = await fs.stat(p);
        return { integrity, size: st.size };
      });
      if (!r.ok) {
        if (r.reason === 'error') problems.push(`${name} 打开失败：${r.error}`);
        continue; // 缺失 = 功能未使用，正常
      }
      sizes.push(`${name} ${formatSize(r.value.size)}`);
      if (r.value.integrity !== 'ok') problems.push(`${name} quick_check：${r.value.integrity}`);
    }
    if (problems.length > 0) return errCheck(def, `${problems.join('；')}`);
    return okCheck(def, sizes.length > 0 ? sizes.join('，') : '无次要数据库');
  }),
];
