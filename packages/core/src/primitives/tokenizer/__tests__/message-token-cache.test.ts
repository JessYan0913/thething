import { describe, it, expect } from 'vitest';
import { MessageTokenCache, cacheFingerprint } from '../message-token-cache';

// 构造 ModelMessage（.content 数组格式）
function modelMsg(role: string, content: unknown[] | string): import('ai').ModelMessage {
  return { id: 'm', role: role as import('ai').ModelMessage['role'], content } as import('ai').ModelMessage;
}

// 构造 UIMessage（.parts 格式）
function uiMsg(role: string, parts: unknown[]): import('ai').ModelMessage {
  return { id: 'm', role: role as import('ai').ModelMessage['role'], parts } as unknown as import('ai').ModelMessage;
}

describe('MessageTokenCache', () => {
  it('get/set/delete/clear round-trip', () => {
    const c = new MessageTokenCache();
    c.set('a', 10);
    expect(c.get('a')).toBe(10);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
    c.set('b', 5);
    c.clear();
    expect(c.get('b')).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('evicts old entries when over capacity', () => {
    const c = new MessageTokenCache();
    for (let i = 0; i < 5002; i++) c.set(`k${i}`, i);
    expect(c.size).toBeLessThanOrEqual(5000);
    // 最先插入的被淘汰
    expect(c.get('k0')).toBeUndefined();
  });
});

describe('cacheFingerprint', () => {
  it('text messages fingerprint by length + head/tail', () => {
    const a = modelMsg('user', 'hello world');
    const b = modelMsg('user', 'hello worlx');
    const c = modelMsg('assistant', 'hello world');
    expect(cacheFingerprint(a, undefined)).not.toBe(cacheFingerprint(b, undefined));
    expect(cacheFingerprint(a, undefined)).not.toBe(cacheFingerprint(c, undefined));
  });

  it('modelName is part of the key', () => {
    const m = modelMsg('user', 'hi there');
    expect(cacheFingerprint(m, 'gpt-4o')).not.toBe(cacheFingerprint(m, 'qwen'));
  });

  it('compacting a tool result changes the fingerprint (miss on rewrite)', () => {
    const out = { summary: 'Bash ...', _compacted: true, _originalSize: 9999 };
    const before = modelMsg('user', [{ type: 'tool-result', toolCallId: 'c1', output: { stdout: 'x'.repeat(5000) } }]);
    const after = modelMsg('user', [{ type: 'tool-result', toolCallId: 'c1', output: out }]);
    expect(cacheFingerprint(after, undefined)).not.toBe(cacheFingerprint(before, undefined));
  });

  it('UIMessage parts format: tool-invocation result change flips fingerprint', () => {
    const before = uiMsg('user', [
      { type: 'tool-invocation', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' }, result: 'x'.repeat(2000), state: 'result' },
    ]);
    const after = uiMsg('user', [
      { type: 'tool-invocation', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' }, result: { summary: 'Bash → done', _compacted: true }, state: 'result' },
    ]);
    expect(cacheFingerprint(after, undefined)).not.toBe(cacheFingerprint(before, undefined));
  });

  it('different UIMessage tool messages with same role do not collide', () => {
    const a = uiMsg('user', [{ type: 'tool-invocation', toolCallId: 't1', toolName: 'bash', args: {}, result: 'aaa', state: 'result' }]);
    const b = uiMsg('user', [{ type: 'tool-invocation', toolCallId: 't2', toolName: 'grep', args: {}, result: 'bbb', state: 'result' }]);
    expect(cacheFingerprint(a, undefined)).not.toBe(cacheFingerprint(b, undefined));
  });

  it('image/file count flips fingerprint', () => {
    const plain = modelMsg('user', 'hello');
    const withImg = modelMsg('user', [{ type: 'image', image: 'data:...' }]);
    expect(cacheFingerprint(withImg, undefined)).not.toBe(cacheFingerprint(plain, undefined));
  });

  // ── 自定义 UIMessage 工具 part（agent-handler 构造：type: `tool-${toolName}`）──
  // 回归：cacheFingerprint 曾不覆盖 tool-* 类型，导致压缩改写 output 后指纹不变
  // → 命中旧缓存 → 重估不降（超限误报）；且同 role 工具消息共享 key 互相污染。
  function uiToolMsg(role: string, type: string, toolCallId: string, value: string) {
    return uiMsg(role, [
      { type, toolCallId, input: { command: 'echo x' }, output: { type: 'text', value }, state: 'output-available' },
    ]);
  }

  it('custom tool-* part: 压缩改写 output 后指纹必变（压缩后重估 miss）', () => {
    const before = uiToolMsg('assistant', 'tool-bash', 'tc-1', 'A'.repeat(200_000));
    const after = uiToolMsg('assistant', 'tool-bash', 'tc-1', '[已省略 190000 字符]');
    expect(cacheFingerprint(after, undefined)).not.toBe(cacheFingerprint(before, undefined));
  });

  it('custom tool-* part: 不同大小的同 role 工具消息不共享 key（不互相污染）', () => {
    const big = uiToolMsg('assistant', 'tool-bash', 'tc-big', 'B'.repeat(100_000));
    const small = uiToolMsg('assistant', 'tool-web_fetch', 'tc-small', 'x');
    expect(cacheFingerprint(small, undefined)).not.toBe(cacheFingerprint(big, undefined));
  });

  it('custom tool-* part: error 与 output-available 指纹不同', () => {
    const ok = uiMsg('assistant', [
      { type: 'tool-bash', toolCallId: 'tc-1', input: { command: 'x' }, output: { type: 'text', value: 'done' }, state: 'output-available' },
    ]);
    const err = uiMsg('assistant', [
      { type: 'tool-bash', toolCallId: 'tc-1', input: { command: 'x' }, output: null, state: 'output-error', errorText: 'exit=1' },
    ]);
    expect(cacheFingerprint(err, undefined)).not.toBe(cacheFingerprint(ok, undefined));
  });
});
