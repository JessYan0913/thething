const DAY_MS = 24 * 60 * 60 * 1000;

export interface FreshnessNote {
  note: string;
  ageDays: number;
}

export function memoryFreshnessNote(mtimeMs: number): FreshnessNote | null {
  const ageMs = Date.now() - mtimeMs;
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

export function computeMemoryAgeStats(mtimeMs: number): {
  ageDays: number;
  isStale: boolean;
  isVeryStale: boolean;
} {
  const ageMs = Date.now() - mtimeMs;
  const ageDays = Math.floor(ageMs / DAY_MS);

  return {
    ageDays,
    isStale: ageDays >= 30,
    isVeryStale: ageDays >= 90,
  };
}
