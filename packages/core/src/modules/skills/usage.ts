// ============================================================
// Skill Usage - 使用统计（常驻集活跃度信号）
// ============================================================
//
// 存储：<dataDir>/skill-usage.json，结构 { [name]: { count, lastUsedAt } }。
// 技能是用户级资源，统计也是用户级；不进 chat.db，避免 schema 迁移。
//
// 已知取舍：读-改-写 + 临时文件原子 rename，多会话并发写为
// last-writer-wins，可能丢个别计数——统计只用于排序，不引入锁。

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../primitives/logger';

const USAGE_FILE_NAME = 'skill-usage.json';

/** 时间衰减半衰期：14 天 */
const DECAY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

export interface SkillUsageEntry {
  count: number;
  lastUsedAt: number;
}

export type SkillUsageMap = Record<string, SkillUsageEntry>;

function usageFilePath(dataDir: string): string {
  return path.join(dataDir, USAGE_FILE_NAME);
}

/**
 * 读取使用统计。文件不存在或损坏返回空映射（容错，不抛出）。
 */
export async function loadSkillUsage(dataDir: string): Promise<SkillUsageMap> {
  try {
    const content = await fs.readFile(usageFilePath(dataDir), 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: SkillUsageMap = {};
    for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const { count, lastUsedAt } = entry as { count?: unknown; lastUsedAt?: unknown };
      if (typeof count === 'number' && typeof lastUsedAt === 'number') {
        result[name] = { count, lastUsedAt };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 记一笔技能使用。内部容错：写失败仅 debug 日志，不影响技能执行。
 */
export async function recordSkillUsage(dataDir: string, skillName: string): Promise<void> {
  try {
    const usage = await loadSkillUsage(dataDir);
    const prev = usage[skillName];
    usage[skillName] = {
      count: (prev?.count ?? 0) + 1,
      lastUsedAt: Date.now(),
    };
    const file = usageFilePath(dataDir);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(usage, null, 2), 'utf-8');
    await fs.rename(tmp, file);
  } catch (err) {
    logger.debug('SkillUsage', `Failed to record usage for "${skillName}": ${err}`);
  }
}

/**
 * 活跃度打分：count × 指数时间衰减（半衰期 14 天）。无记录返回 0。
 */
export function usageScore(entry: SkillUsageEntry | undefined, now: number = Date.now()): number {
  if (!entry) return 0;
  const age = Math.max(0, now - entry.lastUsedAt);
  return entry.count * Math.pow(0.5, age / DECAY_HALF_LIFE_MS);
}
