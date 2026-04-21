import { describe, it, expect, beforeEach } from 'vitest';
import { DenialTracker } from '../denial-tracking';

// ============================================================
// Denial Tracking Tests
// ============================================================
describe('denial-tracking', () => {
  describe('DenialTracker', () => {
    let tracker: DenialTracker;

    beforeEach(() => {
      tracker = new DenialTracker({
        maxDenialsPerTool: 3,
        cooldownPeriodMs: 300_000, // 5 minutes
      });
    });

    describe('constructor', () => {
      it('should initialize with default config', () => {
        const defaultTracker = new DenialTracker();
        expect(defaultTracker.getDenialCount('bash')).toBe(0);
      });

      it('should accept custom config', () => {
        const customTracker = new DenialTracker({
          maxDenialsPerTool: 5,
          cooldownPeriodMs: 600_000,
        });
        expect(customTracker.getDenialCount('bash')).toBe(0);
      });
    });

    describe('record', () => {
      it('should record a denial', () => {
        tracker.record('bash', 'User denied');
        expect(tracker.getDenialCount('bash')).toBe(1);
      });

      it('should increment count on multiple denials', () => {
        tracker.record('bash', 'Denied 1');
        tracker.record('bash', 'Denied 2');
        tracker.record('bash', 'Denied 3');
        expect(tracker.getDenialCount('bash')).toBe(3);
      });

      it('should track different tools separately', () => {
        tracker.record('bash', 'Denied');
        tracker.record('read_file', 'Denied');
        expect(tracker.getDenialCount('bash')).toBe(1);
        expect(tracker.getDenialCount('read_file')).toBe(1);
      });

      it('should be case-insensitive', () => {
        tracker.record('Bash', 'Denied');
        tracker.record('bash', 'Denied');
        expect(tracker.getDenialCount('bash')).toBe(2);
        expect(tracker.getDenialCount('BASH')).toBe(2);
      });
    });

    describe('getDenialCount', () => {
      it('should return 0 for untracked tool', () => {
        expect(tracker.getDenialCount('unknown')).toBe(0);
      });

      it('should return correct count', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        expect(tracker.getDenialCount('bash')).toBe(2);
      });
    });

    describe('isThresholdExceeded', () => {
      it('should return false when under threshold', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        expect(tracker.isThresholdExceeded()).toBe(false);
      });

      it('should return true when threshold exceeded', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        tracker.record('bash', '3');
        expect(tracker.isThresholdExceeded()).toBe(true);
      });

      it('should return false after cooldown', async () => {
        const shortCooldownTracker = new DenialTracker({
          maxDenialsPerTool: 3,
          cooldownPeriodMs: 100,
        });
        shortCooldownTracker.record('bash', '1');
        shortCooldownTracker.record('bash', '2');
        shortCooldownTracker.record('bash', '3');
        expect(shortCooldownTracker.isThresholdExceeded()).toBe(true);

        // Wait for cooldown
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(shortCooldownTracker.isThresholdExceeded()).toBe(false);
      });
    });

    describe('isToolExceeded', () => {
      it('should return false when under threshold', () => {
        tracker.record('bash', '1');
        expect(tracker.isToolExceeded('bash')).toBe(false);
      });

      it('should return true when threshold exceeded', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        tracker.record('bash', '3');
        expect(tracker.isToolExceeded('bash')).toBe(true);
      });

      it('should return false for other tools', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        tracker.record('bash', '3');
        expect(tracker.isToolExceeded('read_file')).toBe(false);
      });
    });

    describe('getInjectMessage', () => {
      it('should return null when no threshold exceeded', () => {
        tracker.record('bash', '1');
        expect(tracker.getInjectMessage()).toBeNull();
      });

      it('should return warning message when threshold exceeded', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        tracker.record('bash', '3');
        const message = tracker.getInjectMessage();
        expect(message).toBeDefined();
        expect(message?.role).toBe('system');
        expect(message?.content).toContain('bash');
      });

      it('should include count in message', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        tracker.record('bash', '3');
        const message = tracker.getInjectMessage();
        expect(message?.content).toContain('3');
      });
    });

    describe('getSummary', () => {
      it('should return empty summary initially', () => {
        const summary = tracker.getSummary();
        expect(summary.totalActiveDenials).toBe(0);
        expect(summary.exceededTools.length).toBe(0);
        expect(summary.allDenials.length).toBe(0);
      });

      it('should return correct summary after denials', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        tracker.record('bash', '3');
        tracker.record('read_file', '1');
        const summary = tracker.getSummary();
        expect(summary.totalActiveDenials).toBe(4);
        expect(summary.exceededTools).toContain('bash');
        expect(summary.exceededTools).not.toContain('read_file');
      });
    });

    describe('reset', () => {
      it('should clear all denials', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        tracker.record('bash', '3');
        tracker.reset();
        expect(tracker.getDenialCount('bash')).toBe(0);
        expect(tracker.isThresholdExceeded()).toBe(false);
      });
    });

    describe('resetTool', () => {
      it('should clear specific tool denials', () => {
        tracker.record('bash', '1');
        tracker.record('bash', '2');
        tracker.record('bash', '3');
        tracker.record('read_file', '1');
        tracker.resetTool('bash');
        expect(tracker.getDenialCount('bash')).toBe(0);
        expect(tracker.getDenialCount('read_file')).toBe(1);
      });

      it('should be case-insensitive', () => {
        tracker.record('bash', '1');
        tracker.resetTool('BASH');
        expect(tracker.getDenialCount('bash')).toBe(0);
      });
    });
  });
});