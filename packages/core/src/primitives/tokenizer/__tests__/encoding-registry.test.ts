import { describe, it, expect } from 'vitest';
import { resolveEncoding, getEncodingLevel, isKnownModel } from '../encoding-registry';

describe('encoding-registry', () => {
  it('resolves GPT-4o to exact o200k', () => {
    const r = resolveEncoding('gpt-4o');
    expect(r.level).toBe('exact');
    expect(r.encoding).toBe('o200k_base');
  });

  it('does not let gpt-4 prefix shadow gpt-4o (longest prefix wins)', () => {
    expect(resolveEncoding('gpt-4o').encoding).toBe('o200k_base');
    expect(resolveEncoding('gpt-4').encoding).toBe('cl100k_base');
    expect(resolveEncoding('gpt-4.1').encoding).toBe('o200k_base');
  });

  it('resolves o-series to exact o200k', () => {
    expect(resolveEncoding('o3').level).toBe('exact');
    expect(resolveEncoding('o4-mini').encoding).toBe('o200k_base');
  });

  it('resolves known model families to approximate cl100k (case-insensitive, vendor prefixes)', () => {
    expect(resolveEncoding('deepseek-v4-pro').level).toBe('approximate');
    expect(resolveEncoding('qwen3-max').encoding).toBe('cl100k_base');
    expect(resolveEncoding('claude-opus-4-6').level).toBe('approximate');
    expect(resolveEncoding('GLM-4.5').level).toBe('approximate');
  });

  it('falls back to char for unknown / undefined models', () => {
    expect(resolveEncoding('some-future-model-9000').level).toBe('char');
    expect(resolveEncoding(undefined).level).toBe('char');
    expect(resolveEncoding('').level).toBe('char');
  });

  it('getEncodingLevel and isKnownModel agree with resolveEncoding', () => {
    expect(getEncodingLevel('gpt-4o')).toBe('exact');
    expect(getEncodingLevel('qwen')).toBe('approximate');
    expect(getEncodingLevel('unknown-x')).toBe('char');
    expect(isKnownModel('claude')).toBe(true);
    expect(isKnownModel('unknown-x')).toBe(false);
  });
});
