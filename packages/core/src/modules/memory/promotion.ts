// ============================================================
// Memory Promotion & Dormancy — Layer 2 信任层
// ============================================================
// 晋升：inferred 记忆经过验证后升级为 promoted
// 休眠：长期未召回的记忆降低权重
// 支持分层阈值：identity/pattern/state 各有不同的生命周期参数

import { loadUsageData, type MemoryUsageData } from './usage-tracker';
import type { ScannedMemory } from './memory-scan';
import type { MemoryTier } from './tiered-storage';

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// 分层生命周期配置
// ============================================================

export interface TierLifecycleConfig {
  /** 晋升所需最少召回次数 */
  promotionMinRecalls: number;
  /** 晋升所需最少创建天数 */
  promotionMinAgeDays: number;
  /** 休眠阈值（天）：超过此天数未召回进入休眠 */
  dormantAfterDays: number;
  /** 归档阈值（天）：休眠超过此天数进入待归档 */
  archiveAfterDays: number;
}

export const TIER_LIFECYCLE: Record<MemoryTier, TierLifecycleConfig> = {
  identity: {
    // identity 层通常是 explicit，不需要晋升
    // 永不休眠，永不归档
    promotionMinRecalls: Infinity,
    promotionMinAgeDays: Infinity,
    dormantAfterDays: Infinity,
    archiveAfterDays: Infinity,
  },
  pattern: {
    // pattern 层：3次召回+7天可晋升，60天休眠，180天归档
    promotionMinRecalls: 3,
    promotionMinAgeDays: 7,
    dormantAfterDays: 60,
    archiveAfterDays: 180,
  },
  state: {
    // state 层：2次召回+3天可晋升，14天休眠，30天归档
    promotionMinRecalls: 2,
    promotionMinAgeDays: 3,
    dormantAfterDays: 14,
    archiveAfterDays: 30,
  },
};

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
 * 根据层级使用不同的阈值：
 * - identity: 永不晋升（通常是 explicit）
 * - pattern: 3次召回 + 7天
 * - state: 2次召回 + 3天
 */
export function checkPromotionEligibility(
  memory: ScannedMemory,
  usage: { recallCount: number; lastRecalledAt: string | null },
  tier: MemoryTier = 'state',
  now: number = Date.now(),
): PromotionCheck {
  if (memory.source !== 'inferred') {
    return { eligible: false, reason: '非归纳记忆' };
  }

  const config = TIER_LIFECYCLE[tier];

  if (usage.recallCount < config.promotionMinRecalls) {
    return { eligible: false, reason: `召回次数不足（${usage.recallCount}/${config.promotionMinRecalls}）` };
  }

  const ageDays = (now - memory.mtimeMs) / DAY_MS;
  if (ageDays < config.promotionMinAgeDays) {
    return { eligible: false, reason: `创建时间不足（${Math.floor(ageDays)}天/${config.promotionMinAgeDays}天）` };
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
      const tier = (memory as any).tier || 'state';
      const check = checkPromotionEligibility(memory, usage, tier);
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
 * 根据层级使用不同的阈值：
 * - identity: 永不休眠
 * - pattern: 60天休眠，180天归档
 * - state: 14天休眠，30天归档
 */
export function computeDormancy(
  confidence: number,
  lastRecalledAt: string | null,
  mtimeMs: number,
  tier: MemoryTier = 'state',
  now: number = Date.now(),
): DormancyInfo {
  // identity 层永不休眠
  if (tier === 'identity') {
    return {
      status: 'active',
      label: '活跃',
      weightMultiplier: 1.0,
    };
  }

  const config = TIER_LIFECYCLE[tier];
  const referenceTime = lastRecalledAt
    ? new Date(lastRecalledAt).getTime()
    : mtimeMs;
  const daysSinceAccess = (now - referenceTime) / DAY_MS;

  // 低置信度或超过休眠阈值
  if (confidence < 0.5 || daysSinceAccess > config.dormantAfterDays) {
    if (daysSinceAccess > config.archiveAfterDays) {
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
