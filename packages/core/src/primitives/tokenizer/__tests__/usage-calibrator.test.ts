import { describe, it, expect } from 'vitest';
import { UsageCalibrator } from '../usage-calibrator';

describe('UsageCalibrator', () => {
  it('cold start ratio is 1 and buffer ratio 0', () => {
    const c = new UsageCalibrator();
    expect(c.getDriftRatio('gpt')).toBe(1);
    expect(c.getTokenizerBufferRatio('gpt')).toBe(0);
    expect(c.getSamples('gpt')).toBe(0);
  });

  it('first sample is adopted directly (clamped)', () => {
    const c = new UsageCalibrator();
    c.record('gpt', 1000, 1150); // ratio 1.15
    expect(c.getDriftRatio('gpt')).toBeCloseTo(1.15, 5);
  });

  it('EMA smooths subsequent samples', () => {
    const c = new UsageCalibrator();
    c.record('gpt', 1000, 1000); // 1.0
    c.record('gpt', 1000, 1000); // 1.0
    expect(c.getDriftRatio('gpt')).toBeCloseTo(1.0, 5);
    // 新样本 1.4 → EMA = 1.0*(0.7) + 1.4*(0.3) = 1.12
    c.record('gpt', 1000, 1400);
    expect(c.getDriftRatio('gpt')).toBeCloseTo(1.12, 5);
  });

  it('clamps accepted samples into [0.85, 1.6]', () => {
    const c = new UsageCalibrator();
    c.record('gpt', 1000, 2500); // ratio 2.5 (<3 accepted) → clamp 1.6
    expect(c.getDriftRatio('gpt')).toBe(1.6);
    c.reset('gpt');
    c.record('gpt', 1000, 600); // ratio 0.6 (>0.5 accepted) → clamp 0.85
    expect(c.getDriftRatio('gpt')).toBe(0.85);
  });

  it('rejects anomalous samples (<0.5 or >3)', () => {
    const c = new UsageCalibrator();
    c.record('gpt', 1000, 100); // 0.1 → rejected
    expect(c.getSamples('gpt')).toBe(0);
    c.record('gpt', 1000, 10000); // 10 → rejected
    expect(c.getSamples('gpt')).toBe(0);
    c.record('gpt', 1000, 1150); // 1.15 → accepted
    expect(c.getSamples('gpt')).toBe(1);
  });

  it('ignores zero/negative inputs', () => {
    const c = new UsageCalibrator();
    c.record('gpt', 0, 1000);
    c.record('gpt', 1000, 0);
    c.record('gpt', -1, 1000);
    expect(c.getSamples('gpt')).toBe(0);
  });

  it('buckets by modelName and reset clears per-model', () => {
    const c = new UsageCalibrator();
    c.record('gpt', 1000, 1200);
    c.record('qwen', 1000, 1800); // ratio 1.8 → clamp 1.6
    expect(c.getDriftRatio('gpt')).toBeCloseTo(1.2, 5);
    expect(c.getDriftRatio('qwen')).toBe(1.6);
    c.reset('gpt');
    expect(c.getDriftRatio('gpt')).toBe(1);
    expect(c.getDriftRatio('qwen')).toBe(1.6);
  });

  it('clear resets everything', () => {
    const c = new UsageCalibrator();
    c.record('gpt', 1000, 1200);
    c.clear();
    expect(c.getDriftRatio('gpt')).toBe(1);
  });

  it('tokenizerBufferRatio = driftRatio − 1', () => {
    const c = new UsageCalibrator();
    c.record('gpt', 1000, 1300);
    expect(c.getTokenizerBufferRatio('gpt')).toBeCloseTo(0.3, 5);
  });
});
