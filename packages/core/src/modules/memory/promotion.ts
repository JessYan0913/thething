// ============================================================
// Memory Promotion & Dormancy — Layer 2 信任层
// ============================================================
// 晋升：inferred 记忆经过验证后升级为 promoted
// 休眠：长期未召回的记忆降低权重

import { loadUsageData, type MemoryUsageData } from './usage-tracker';
import type { ScannedMemory } from './memory-scan';

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// 晋升条件
// ============================================================

export interface PromotionCheck {
  eligible: boolean;
  reason: string;
}

/**
 * 检查一条 inferred 记忆是否满足晋升条件
 *
 * 条件：
 * 1. source === 'inferred'
 * 2. recallCount >= 3（被多次需要，说明有价值）
 * 3. 创建超过 7 天（经过足够时间检验）
 * 4. 未被用户纠正（confidence 未被大幅下调）
 */
export function checkPromotionEligibility(
  memory: ScannedMemory,
  usage: { recallCount: number; lastRecalledAt: string | null },
  now: number = Date.now(),
): PromotionCheck {
  if (memory.source !== 'inferred') {
    return { eligible: false, reason: '非归纳记忆' };
  }

  if (usage.recallCount < 3) {
    return { eligible: false, reason: `召回次数不足（${usage.recallCount}/3）` };
  }

  const ageDays = (now - memory.mtimeMs) / DAY_MS;
  if (ageDays < 7) {
    return { eligible: false, reason: `创建时间不足（${Math.floor(ageDays)}天/7天）` };
  }

  // confidence 低于 0.2 说明被用户大幅纠正过，不应晋升
  if (memory.confidence < 0.2) {
    return { eligible: false, reason: '已被用户纠正，置信度过低' };
  }

  return { eligible: true, reason: '满足所有晋升条件' };
}

/**
 * 批量检查哪些记忆可以晋升
 */
export async function findPromotableMemories(
  memories: ScannedMemory[],
  memoryDir: string,
): Promise<Array<{ memory: ScannedMemory; usage: { recallCount: number; lastRecalledAt: string | null }; check: PromotionCheck }>> {
  const usageData = await loadUsageData(memoryDir);

  return memories
    .filter((m) => m.source === 'inferred')
    .map((memory) => {
      const usage = usageData[memory.filename] || { recallCount: 0, lastRecalledAt: null };
      const check = checkPromotionEligibility(memory, usage);
      return { memory, usage, check };
    })
    .filter((item) => item.check.eligible);
}

// ============================================================
// 休眠状态
// ============================================================

export type DormancyStatus = 'active' | 'dormant' | 'pending_archive';

export interface DormancyInfo {
  status: DormancyStatus;
  label: string;
  /** 休眠状态下的检索权重乘数 */
  weightMultiplier: number;
}

/**
 * 计算记忆的休眠状态
 *
 * - active: 30 天内有召回，或 confidence >= 0.5
 * - dormant: confidence < 0.5 或 30 天未召回
 * - pending_archive: 休眠超过 90 天
 */
export function computeDormancy(
  confidence: number,
  lastRecalledAt: string | null,
  mtimeMs: number,
  now: number = Date.now(),
): DormancyInfo {
  const referenceTime = lastRecalledAt
    ? new Date(lastRecalledAt).getTime()
    : mtimeMs;
  const daysSinceAccess = (now - referenceTime) / DAY_MS;

  if (confidence < 0.5 || daysSinceAccess > 30) {
    if (daysSinceAccess > 90) {
      return {
        status: 'pending_archive',
        label: '待归档',
        weightMultiplier: 0.1,
      };
    }
    return {
      status: 'dormant',
      label: '休眠',
      weightMultiplier: 0.3,
    };
  }

  return {
    status: 'active',
    label: '活跃',
    weightMultiplier: 1.0,
  };
}
