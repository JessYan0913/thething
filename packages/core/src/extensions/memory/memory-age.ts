// ============================================================
// Memory Age - 记忆新鲜度计算
// ============================================================
//
// 用于计算记忆文件的新鲜度，帮助 Agent 判断记忆是否过期。
// 支持 Clock 注入，便于测试时间相关逻辑。
// ============================================================

import type { Clock } from '../../foundation/clock/types';
import { systemClock } from '../../foundation/clock/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FreshnessNote {
  note: string;
  ageDays: number;
}

/**
 * 计算记忆新鲜度提示
 *
 * @param mtimeMs - 文件修改时间（毫秒）
 * @param clock - 时间提供器（默认使用系统时间）
 * @returns 新鲜度提示，当天创建返回 null
 */
export function memoryFreshnessNote(
  mtimeMs: number,
  clock: Clock = systemClock
): FreshnessNote | null {
  const ageMs = clock.now() - mtimeMs;
  const ageDays = Math.floor(ageMs / DAY_MS);

  if (ageDays < 1) return null;
  if (ageDays < 7) {
    return {
      note: `[记忆创建于一周前]`,
      ageDays,
    };
  }
  if (ageDays < 30) {
    return {
      note: `[记忆创建于 ${ageDays} 天前，请验证是否仍然有效]`,
      ageDays,
    };
  }
  return {
    note: `[记忆创建于 ${ageDays} 天前，可能已过期，请仔细验证]`,
    ageDays,
  };
}

/**
 * 计算记忆年龄统计
 *
 * @param mtimeMs - 文件修改时间（毫秒）
 * @param clock - 时间提供器（默认使用系统时间）
 * @returns 年龄统计（天数、是否过期、是否严重过期）
 */
export function computeMemoryAgeStats(
  mtimeMs: number,
  clock: Clock = systemClock
): {
  ageDays: number;
  isStale: boolean;
  isVeryStale: boolean;
} {
  const ageMs = clock.now() - mtimeMs;
  const ageDays = Math.floor(ageMs / DAY_MS);

  return {
    ageDays,
    isStale: ageDays >= 30,
    isVeryStale: ageDays >= 90,
  };
}
