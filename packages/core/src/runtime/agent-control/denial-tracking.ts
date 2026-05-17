import { DEFAULT_MAX_DENIALS_PER_TOOL } from '../../config/defaults';

export interface DenialEntry {
  count: number;
  lastDeniedAt: number;
  toolName: string;
  lastReason?: string;
}

export interface DenialTrackerConfig {
  maxDenialsPerTool?: number;
  cooldownPeriodMs?: number;
  warningMessage?: string;
}

const DEFAULT_CONFIG: Required<DenialTrackerConfig> = {
  maxDenialsPerTool: DEFAULT_MAX_DENIALS_PER_TOOL,
  cooldownPeriodMs: 5 * 60 * 1000,
  warningMessage: '⚠️ 你尝试使用的操作 "{{tool}}" 已被拒绝多次。请换用其他方法或工具，不要继续尝试同一操作。',
};

export class DenialTracker {
  private _denials: Map<string, DenialEntry> = new Map();
  private _config: Required<DenialTrackerConfig>;

  constructor(config?: DenialTrackerConfig) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  record(toolName: string, reason?: string): void {
    const key = toolName.toLowerCase();
    const existing = this._denials.get(key);
    const now = Date.now();

    if (existing) {
      if (now - existing.lastDeniedAt > this._config.cooldownPeriodMs) {
        this._denials.set(key, {
          count: 1,
          lastDeniedAt: now,
          toolName,
          lastReason: reason,
        });
      } else {
        existing.count += 1;
        existing.lastDeniedAt = now;
        existing.lastReason = reason;
      }
    } else {
      this._denials.set(key, {
        count: 1,
        lastDeniedAt: now,
        toolName,
        lastReason: reason,
      });
    }
  }

  getDenialCount(toolName: string): number {
    const key = toolName.toLowerCase();
    const entry = this._denials.get(key);
    if (!entry) return 0;

    if (Date.now() - entry.lastDeniedAt > this._config.cooldownPeriodMs) {
      return 0;
    }

    return entry.count;
  }

  isThresholdExceeded(): boolean {
    for (const entry of this._denials.values()) {
      if (entry.count >= this._config.maxDenialsPerTool) {
        if (Date.now() - entry.lastDeniedAt <= this._config.cooldownPeriodMs) {
          return true;
        }
      }
    }
    return false;
  }

  isToolExceeded(toolName: string): boolean {
    return this.getDenialCount(toolName) >= this._config.maxDenialsPerTool;
  }

  getInjectMessage(): { role: 'system'; content: string } | null {
    const exceeded: DenialEntry[] = [];

    for (const entry of this._denials.values()) {
      if (
        entry.count >= this._config.maxDenialsPerTool &&
        Date.now() - entry.lastDeniedAt <= this._config.cooldownPeriodMs
      ) {
        exceeded.push(entry);
      }
    }

    if (exceeded.length === 0) return null;

    const warnings = exceeded
      .map((e) => {
        const msg = this._config.warningMessage.replace('{{tool}}', e.toolName);
        if (msg.includes('{{count}}')) {
          return msg.replace('{{count}}', String(e.count));
        }
        return msg + `（已拒绝 ${e.count} 次）`;
      })
      .join('\n\n');

    return {
      role: 'system',
      content: warnings,
    };
  }

  getSummary(): {
    totalActiveDenials: number;
    exceededTools: string[];
    allDenials: DenialEntry[];
  } {
    const now = Date.now();
    const activeDenials = Array.from(this._denials.values()).filter(
      (e) => now - e.lastDeniedAt <= this._config.cooldownPeriodMs,
    );

    return {
      totalActiveDenials: activeDenials.reduce((sum, e) => sum + e.count, 0),
      exceededTools: activeDenials.filter((e) => e.count >= this._config.maxDenialsPerTool).map((e) => e.toolName),
      allDenials: activeDenials,
    };
  }

  reset(): void {
    this._denials.clear();
  }

  resetTool(toolName: string): void {
    this._denials.delete(toolName.toLowerCase());
  }
}
