// ============================================================
// Doctor Module — 诊断 + 修复引擎入口
// ============================================================
// 确定性诊断（CHECKS）+ 保守修复（REPAIRS）。无 LLM。
// 被 /api/doctor 路由与 CLI 脚本（scripts/doctor.mts）共用。

import { getDatabase } from '../../services/datastore/sqlite/native-loader';
import { resolveHomeDir } from '../../primitives/paths';
import type { DataStore, SqliteDatabase } from '../../primitives/datastore/types';
import type { ResolvedLayout } from '../../services/config/layout';
import { CHECKS } from './checks';
import { applyRepair } from './repairs';
import type { DoctorContext, DoctorReport } from './types';

export { resolveTheThingLayout } from './layout';
export { CHECKS } from './checks';
export { REPAIRS, applyRepair } from './repairs';
export type {
  DoctorContext,
  CheckStatus,
  CheckResult,
  CheckDef,
  CheckCategory,
  DoctorReport,
  RepairOutcome,
  RepairDef,
} from './types';

/**
 * 构造 doctor 上下文。
 * - openDb 默认用 getDatabase()（只读打开失败时回退普通连接，兼容 WAL 库）
 * - homeDir 默认 resolveHomeDir()（THETHING_HOME_DIR 感知）
 */
export function createDoctorContext(deps: {
  layout: ResolvedLayout;
  dataStore?: DataStore;
  homeDir?: string;
  openDb?: DoctorContext['openDb'];
}): DoctorContext {
  const Database = getDatabase();
  return {
    layout: deps.layout,
    dataStore: deps.dataStore,
    homeDir: deps.homeDir ?? resolveHomeDir(),
    openDb: deps.openDb ?? ((filePath, opts) => {
      // 只传显式声明的选项（better-sqlite3 拒绝 undefined 值）
      const options: { readonly?: boolean; fileMustExist?: boolean } = {};
      if (opts?.readonly !== undefined) options.readonly = opts.readonly;
      if (opts?.fileMustExist !== undefined) options.fileMustExist = opts.fileMustExist;
      try {
        return new Database(filePath, options);
      } catch (e) {
        // WAL 库只读打开可能因 -shm 缺失失败；诊断只读操作回退普通连接
        if (opts?.readonly) return new Database(filePath, { fileMustExist: opts.fileMustExist });
        throw e;
      }
    }),
  };
}

/** 运行全部检查，聚合报告。每项自查错，绝不 throw。 */
export async function runDoctor(ctx: DoctorContext): Promise<DoctorReport> {
  const results = await Promise.all(CHECKS.map((check) => Promise.resolve(check.run(ctx))));
  const summary = { ok: 0, warn: 0, error: 0 };
  for (const r of results) {
    if (r.status === 'ok') summary.ok++;
    else if (r.status === 'warn') summary.warn++;
    else summary.error++;
  }
  return {
    generatedAt: new Date().toISOString(),
    configDir: ctx.layout.configDir,
    dataDir: ctx.layout.dataDir,
    checks: results,
    summary,
  };
}
