import type { SkillUsageRecord } from './types';

const HALF_LIFE_HOURS = 168;

const usageRecords = new Map<string, SkillUsageRecord>();

export function recordSkillUsage(skillName: string): void {
  const now = Date.now();
  const existing = usageRecords.get(skillName);

  if (existing) {
    existing.count += 1;
    existing.lastUsedAt = now;
    existing.decayedScore = calculateDecayedScore(existing);
  } else {
    const record: SkillUsageRecord = {
      skillName,
      count: 1,
      lastUsedAt: now,
      decayedScore: 1,
    };
    usageRecords.set(skillName, record);
  }
}

export function getRankedSkills(): SkillUsageRecord[] {
  return Array.from(usageRecords.values())
    .map((record) => ({
      ...record,
      decayedScore: calculateDecayedScore(record),
    }))
    .sort((a, b) => b.decayedScore - a.decayedScore);
}

export function getSkillUsage(skillName: string): SkillUsageRecord | undefined {
  return usageRecords.get(skillName);
}

export function resetSkillUsage(skillName?: string): void {
  if (skillName) {
    usageRecords.delete(skillName);
  } else {
    usageRecords.clear();
  }
}

function calculateDecayedScore(record: SkillUsageRecord): number {
  const hoursSinceLastUse = (Date.now() - record.lastUsedAt) / (1000 * 60 * 60);
  const decayFactor = Math.pow(2, -hoursSinceLastUse / HALF_LIFE_HOURS);

  return record.count * decayFactor;
}

export function getHalfLifeHours(): number {
  return HALF_LIFE_HOURS;
}