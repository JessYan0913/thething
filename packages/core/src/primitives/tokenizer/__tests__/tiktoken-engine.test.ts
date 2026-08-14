import { describe, it, expect, afterEach } from 'vitest';
import {
  countTokensForModel,
  countTokensBatchForModel,
  getEncodingName,
  clearEncodingCache,
  preloadEncoding,
  isEncodingReady,
  PRE_ESTIMATE_CHARS,
  BPE_MAX_CHARS,
} from '../tiktoken-engine';

afterEach(() => clearEncodingCache());

describe('tiktoken-engine', () => {
  it('counts empty text as 0', () => {
    expect(countTokensForModel('', 'gpt-4o')).toBe(0);
  });

  it('unknown model uses char estimation with calibration', () => {
    // 400 latin chars / 4 = 100
    expect(countTokensForModel('a'.repeat(400), 'unknown-model')).toBe(100);
    // calibration multiplies
    expect(countTokensForModel('a'.repeat(400), 'unknown-model', 1.5)).toBe(150);
  });

  it('BPE path gives exact cl100k counts for gpt-4', () => {
    clearEncodingCache();
    const text = 'The quick brown fox jumps over the lazy dog while the model analyzes source files and measures tokens for the context window and budget policy every single step of the pipeline. '.repeat(14);
    const count = countTokensForModel(text, 'gpt-4');
    // 已确认的 js-tiktoken cl100k 计数（2492 chars；与字符估算 623 不同，证明走了 BPE）
    expect(count).toBe(449);
  });

  it('short text (<1000 chars) uses char estimation even for known models', () => {
    const text = 'x'.repeat(50);
    const count = countTokensForModel(text, 'gpt-4');
    expect(count).toBe(Math.ceil(50 / 4));
  });

  it('highly-repeated long text does not go down BPE path (O(n²) guard)', () => {
    const text = 'x'.repeat(10_000);
    // char estimate: 10000 / 4 = 2500
    expect(countTokensForModel(text, 'gpt-4')).toBe(2500);
  });

  it('very long text (>20k chars) uses char estimation', () => {
    const text = 'ab'.repeat(BPE_MAX_CHARS / 2 + 100);
    const count = countTokensForModel(text, 'gpt-4o');
    // char path: len/4
    expect(count).toBe(Math.ceil(text.length / 4));
  });

  it('batch counting reuses the same encoding instance', () => {
    clearEncodingCache();
    const texts = ['short', 'a much longer english sentence with several words and tokens'];
    const counts = countTokensBatchForModel(texts, 'gpt-4');
    expect(counts).toHaveLength(2);
    expect(counts[0]).toBe(Math.ceil('short'.length / 4)); // short → char
    expect(counts[1]).toBeGreaterThan(5);
  });

  it('getEncodingName / preloadEncoding / isEncodingReady', () => {
    expect(getEncodingName('gpt-4o')).toBe('o200k_base');
    expect(getEncodingName('unknown')).toBeNull();
    expect(isEncodingReady('gpt-4o')).toBe(false);
    expect(preloadEncoding('gpt-4o')).toBe(true);
    expect(isEncodingReady('gpt-4o')).toBe(true);
    // unknown model preload is a no-op returning false
    expect(preloadEncoding('unknown-x')).toBe(false);
  });

  it('PRE_ESTIMATE_CHARS / BPE_MAX_CHARS constants are sane', () => {
    expect(PRE_ESTIMATE_CHARS).toBe(1000);
    expect(BPE_MAX_CHARS).toBe(20_000);
  });
});
