// ============================================================
// Doctor 类型 — 诊断/修复引擎的数据契约
// ============================================================

import type { ResolvedLayout } from '../../services/config/layout';
import type { DataStore, SqliteDatabase } from '../../primitives/datastore/types';

/** 诊断/修复上下文：布局 + 可选 store（修复用）+ 只读连接工厂 */
export interface DoctorContext {
  layout: ResolvedLayout;
  /** API 模式与 CLI --fix 模式提供；报告模式（CLI）缺省 */
  dataStore?: DataStore;
  homeDir: string;
  /** 打开一个 SQLite 连接（诊断默认只读）。注入以便测试。 */
  openDb: (filePath: string, opts?: { readonly?: boolean; fileMustExist?: boolean }) => SqliteDatabase;
}

export type CheckStatus = 'ok' | 'warn' | 'error';

export type CheckCategory = 'database' | 'data-dir' | 'wiki' | 'secondary-db';

/** 单项检查结果 */
export interface CheckResult {
  /** 稳定 id，如 'chat-db-wal-size' */
  id: string;
  title: string;
  category: CheckCategory;
  status: CheckStatus;
  /** 人类可读信息，如 "WAL 83MB vs DB 79MB" */
  message: string;
  /** 该项对应的修复 id（有则可修复） */
  fixHint?: string;
  /** 机器可用数据（大小、计数等） */
  data?: Record<string, unknown>;
}

/** 检查定义：每项自查错，绝不 throw */
export interface CheckDef {
  id: string;
  title: string;
  category: CheckCategory;
  run: (ctx: DoctorContext) => Promise<CheckResult> | CheckResult;
}

export type RepairOutcome =
  | { status: 'needs-confirmation'; message: string }
  | { status: 'done'; message: string; detail?: Record<string, unknown> }
  | { status: 'error'; message: string };

/** 修复定义：safety 决定是否需确认 */
export interface RepairDef {
  id: string;
  title: string;
  category: CheckCategory;
  safety: 'safe' | 'destructive';
  apply: (ctx: DoctorContext, opts: { confirmed: boolean }) => Promise<RepairOutcome> | RepairOutcome;
}

/** 完整诊断报告 */
export interface DoctorReport {
  generatedAt: string;
  configDir: string;
  dataDir: string;
  checks: CheckResult[];
  summary: { ok: number; warn: number; error: number };
}
