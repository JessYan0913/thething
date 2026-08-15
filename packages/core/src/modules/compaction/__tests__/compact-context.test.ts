import { describe, expect, it } from 'vitest';
import {
  validateCompactionRequest,
  createCompactContextTool,
  COMPACT_RATE_LIMIT_MS,
  type CompactContextRequest,
} from '../compact-context';

describe('validateCompactionRequest', () => {
  it('低水位（<50%）拒绝——浪费 turn', () => {
    const r = validateCompactionRequest(
      { strategy: 'compress_old_outputs', reason: 'exploration done' },
      { utilizationPercent: 40 },
    );
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('40.0%');
  });

  it('高水位（≥50%）通过', () => {
    const r = validateCompactionRequest(
      { strategy: 'compress_old_outputs', reason: 'exploration done' },
      { utilizationPercent: 70 },
    );
    expect(r.valid).toBe(true);
  });

  it('未知水位（null）不据此拒绝', () => {
    const r = validateCompactionRequest(
      { strategy: 'compress_old_outputs', reason: 'x' },
      { utilizationPercent: null },
    );
    expect(r.valid).toBe(true);
  });

  it('频率限制：1 分钟内拒绝重复压缩', () => {
    const now = Date.now();
    const r = validateCompactionRequest(
      { strategy: 'compress_old_outputs', reason: 'x' },
      { utilizationPercent: 70, lastCompactionAt: now - 5_000 },
    );
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('Too many compressions');
  });

  it('频率限制窗口外通过', () => {
    const r = validateCompactionRequest(
      { strategy: 'compress_old_outputs', reason: 'x' },
      { utilizationPercent: 70, lastCompactionAt: Date.now() - COMPACT_RATE_LIMIT_MS - 1_000 },
    );
    expect(r.valid).toBe(true);
  });

  it('summarize_conversation 暂不支持', () => {
    const r = validateCompactionRequest(
      { strategy: 'summarize_conversation', reason: 'x' },
      { utilizationPercent: 70 },
    );
    expect(r.valid).toBe(false);
  });
});

describe('createCompactContextTool', () => {
  it('高水位：登记请求 + 返回成功', async () => {
    const requestRef: { current: CompactContextRequest | null } = { current: null };
    const t = createCompactContextTool({
      requestRef,
      getUtilizationPercent: () => 75,
    });
    // 工具 execute 可能返回 AsyncIterable（流式）；测试走非流路径，取对象结果
    const result = await t.execute!({ strategy: 'compress_old_outputs', toolNames: ['read_file'], reason: 'exploration done' }, {} as never);
    if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
      throw new Error('unexpected async iterable result');
    }
    const obj = result as { success: boolean; error?: string; message?: string };
    expect(obj.success).toBe(true);
    expect(requestRef.current).toEqual({ toolNames: ['read_file'], reason: 'exploration done' });
  });

  it('低水位：不登记 + 返回错误', async () => {
    const requestRef: { current: CompactContextRequest | null } = { current: null };
    const t = createCompactContextTool({
      requestRef,
      getUtilizationPercent: () => 40,
    });
    const result = await t.execute!({ strategy: 'compress_old_outputs', reason: 'x' }, {} as never);
    if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
      throw new Error('unexpected async iterable result');
    }
    const obj = result as { success: boolean; error?: string };
    expect(obj.success).toBe(false);
    expect(requestRef.current).toBeNull();
  });
});
