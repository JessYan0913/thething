import { describe, it, expect } from 'vitest';
import { estimateTokensFromChars, estimateTokensFromObject } from '../token-estimate';

// ============================================================
// 8.1 估算系数统一 + CJK 校准
// 见 docs/compaction-execution-plan.md 步骤 8.1
// ============================================================

describe('estimateTokensFromChars', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokensFromChars('')).toBe(0);
  });

  it('estimates latin text at ~4 chars/token', () => {
    const text = 'a'.repeat(400);
    // 400 / 4 = 100
    expect(estimateTokensFromChars(text)).toBe(100);
  });

  it('estimates CJK text at ~1.5 chars/token (no longer under-counts by half)', () => {
    const text = '压'.repeat(150);
    // 150 / 1.5 = 100
    expect(estimateTokensFromChars(text)).toBe(100);
  });

  it('CJK yields more tokens than the old /2.5 heuristic', () => {
    const text = '中文压缩测试上下文窗口管理'.repeat(20); // 260 CJK chars
    const oldEstimate = Math.ceil(text.length / 2.5);
    // 新估算按 1.5 校准,应显著高于旧的 /2.5(旧值低估近一半)
    expect(estimateTokensFromChars(text)).toBeGreaterThan(oldEstimate);
  });

  it('mixes latin and CJK proportionally', () => {
    const text = 'code' + '压缩'; // 4 latin + 2 cjk
    // 4/4 + 2/1.5 = 1 + 1.333 = 2.333 → ceil 3
    expect(estimateTokensFromChars(text)).toBe(3);
  });

  it('applies calibration factor', () => {
    const text = 'a'.repeat(400); // base 100
    expect(estimateTokensFromChars(text, 1.2)).toBe(120);
  });
});

describe('estimateTokensFromObject', () => {
  it('estimates serialized objects with a density multiplier', () => {
    const obj = { path: 'src/index.ts', lines: 120 };
    const json = JSON.stringify(obj);
    const plain = estimateTokensFromChars(json);
    // 对象走密集系数,应高于纯字符估算
    expect(estimateTokensFromObject(obj)).toBeGreaterThan(plain);
  });

  it('returns 0 for non-serializable input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimateTokensFromObject(circular)).toBe(0);
  });
});
