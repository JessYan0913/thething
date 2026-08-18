import { describe, it, expect } from 'vitest';
import { isSubstantiveDeliverable } from '../deliverable';

describe('isSubstantiveDeliverable（P0 交付物契约）', () => {
  it('空/undefined/null → 非交付物', () => {
    expect(isSubstantiveDeliverable('')).toBe(false);
    expect(isSubstantiveDeliverable('   ')).toBe(false);
    expect(isSubstantiveDeliverable(undefined)).toBe(false);
    expect(isSubstantiveDeliverable(null)).toBe(false);
  });

  it('executor 兜底文案 → 非交付物', () => {
    expect(
      isSubstantiveDeliverable('Agent completed 5 tool calls using read_file, grep. No text summary was produced.')
    ).toBe(false);
    expect(isSubstantiveDeliverable('Agent completed with no text output.')).toBe(false);
  });

  it('正常交付物（含中文短结论）→ 交付物（保守不误伤）', () => {
    expect(isSubstantiveDeliverable('任务完成')).toBe(true);
    expect(isSubstantiveDeliverable('模块 A 与 B 存在循环依赖，已修复。')).toBe(true);
    expect(isSubstantiveDeliverable('## Final Conclusion\nFound 3 bugs in src/main.ts.')).toBe(true);
    expect(isSubstantiveDeliverable('mocked sub-agent done')).toBe(true);
  });
});
