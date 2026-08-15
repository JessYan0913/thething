import { describe, expect, it } from 'vitest';
import {
  isOutputTruncated,
  MAX_CONTINUATION_TOTAL_TOKENS,
  CONTINUATION_PROMPT,
} from '../output-continuation';

describe('output-continuation', () => {
  describe('isOutputTruncated', () => {
    it('finishReason=length → true（provider 截断）', () => {
      expect(isOutputTruncated('length')).toBe(true);
    });

    it('finishReason=stop → false（正常完成）', () => {
      expect(isOutputTruncated('stop')).toBe(false);
    });

    it('tool-calls / error / content-filter / other → false', () => {
      expect(isOutputTruncated('tool-calls')).toBe(false);
      expect(isOutputTruncated('error')).toBe(false);
      expect(isOutputTruncated('content-filter')).toBe(false);
      expect(isOutputTruncated('other')).toBe(false);
    });

    it('undefined / 空 → false（信号缺失不误判）', () => {
      expect(isOutputTruncated(undefined)).toBe(false);
      expect(isOutputTruncated('')).toBe(false);
    });
  });

  it('MAX_CONTINUATION_TOTAL_TOKENS 是成本护栏（不限制正常写作量）', () => {
    // 护栏应足够大：正常长文（几千 token）远够不到，只有病态死循环才被拦
    expect(MAX_CONTINUATION_TOTAL_TOKENS).toBeGreaterThanOrEqual(16_000);
    expect(MAX_CONTINUATION_TOTAL_TOKENS).toBeLessThanOrEqual(256_000);
  });

  it('CONTINUATION_PROMPT 明确要求接续不重写', () => {
    expect(CONTINUATION_PROMPT).toContain('继续');
    expect(CONTINUATION_PROMPT).toContain('不要重复');
  });
});
