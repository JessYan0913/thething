import { describe, it, expect } from 'vitest';
import type { ModelMessage } from 'ai';
import { manageToolOutputLifecycle } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';
import { ContextLedger } from '../context-ledger';

// ============================================================
// 读循环回归测试
// ============================================================
// 2026-07-25 事故:skill-creator/SKILL.md(489 行≈20KB)被 read_file 读取后,
// largeOutputThreshold(8000)触发 tooLarge 把输出 meta 化为 "Read X -> 489 lines"。
// read_file 不落盘,模型永远看不到内容 -> 反复重读(实测 7 次/31 次) -> 目标漂移。
// 修复:当前步结果豁免 meta(超大改可见截断)+ 读循环熔断(同文件读≥3 次自动 pin)。
// 见 docs/compaction-redesign.md

function userMessage(text: string): ModelMessage {
  return { id: `u-${Math.random()}`, role: 'user', content: [{ type: 'text', text }] } as unknown as ModelMessage;
}

function toolMessage(toolName: string, output: unknown, toolCallId: string): ModelMessage {
  return {
    id: `t-${toolCallId}`,
    role: 'tool',
    content: [{ type: 'tool-result', toolName, toolCallId, output: { type: 'json', value: output } }],
  } as unknown as ModelMessage;
}

function item(msg: ModelMessage): any {
  return ((msg as unknown as Record<string, unknown>).content as any[])[0];
}

describe('current-step exemption (感知-行动环不可断)', () => {
  it('当前步超大 read_file -> 可见截断而非 meta,保留头尾内容', () => {
    const bigSkill = 'line\n'.repeat(4000); // ≈20KB,超过 8000 阈值
    const messages = [
      userMessage('read the skill'),
      toolMessage('read_file', { path: 'skills/SKILL.md', content: bigSkill, totalLines: 4000 }, 'tc-1'),
    ];

    const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);

    const it1 = item(result.messages[1]);
    // 不 meta 化:模型仍能感知刚读的内容
    expect(it1._compacted).toBeUndefined();
    expect(it1._truncated).toBe(true);
    // 可见截断保留头尾 + 省略标记 + 找回提示
    const val: string = it1.output.value;
    expect(val).toContain('[... ');
    expect(val).toContain('chars omitted');
    expect(val).toContain('read_file'); // 找回提示提及 read_file offset/limit
    expect(val.length).toBeLessThan(bigSkill.length); // 确实缩小
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it('当前步超大瞬态工具(bash)也截断而非 meta', () => {
    const big = 'x'.repeat(20000);
    const messages = [
      userMessage('run'),
      toolMessage('bash', { command: 'cat big', stdout: big, exitCode: 0 }, 'tc-1'),
    ];
    const result = manageToolOutputLifecycle(messages, DEFAULT_LIFECYCLE_CONFIG);
    expect(item(result.messages[1])._truncated).toBe(true);
    expect(item(result.messages[1])._compacted).toBeUndefined();
  });

  it('旧步超大 read_file 超出边界 -> meta(语义类仅在当前步豁免)', () => {
    const big = 'line\n'.repeat(4000);
    const messages = [
      userMessage('read'),
      toolMessage('read_file', { path: 'a.ts', content: big, totalLines: 4000 }, 'tc-old'),
      userMessage('then'),
      toolMessage('read_file', { path: 'b.ts', content: 'small', totalLines: 1 }, 'tc-new'), // 当前步
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 });
    // tc-old 超出最近 1 step 边界 -> meta
    expect(item(result.messages[1])._compacted).toBe(true);
    // tc-new 是当前步,小输出 -> 原样
    expect(item(result.messages[3])._compacted).toBeUndefined();
    expect(item(result.messages[3])._truncated).toBeUndefined();
  });
});

describe('读循环熔断 (auto-pin)', () => {
  it('同文件被读 ≥3 次 -> 自动 pin,最新读取保留完整', () => {
    const big = 'line\n'.repeat(4000); // 每次都超大
    const messages = [
      userMessage('read'),
      toolMessage('read_file', { path: 'skills/SKILL.md', content: big, totalLines: 4000 }, 'tc-1'),
      toolMessage('read_file', { path: 'skills/SKILL.md', content: big, totalLines: 4000 }, 'tc-2'),
      toolMessage('read_file', { path: 'skills/SKILL.md', content: big, totalLines: 4000 }, 'tc-3'),
      toolMessage('read_file', { path: 'skills/SKILL.md', content: big, totalLines: 4000 }, 'tc-4'),
    ];
    const ledger = new ContextLedger();

    const result = manageToolOutputLifecycle(
      messages,
      { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 },
      undefined,
      { ledger },
    );

    // tc-4(最新)被 pin 保护,保留完整 -- 不 meta 不截断
    const latest = item(result.messages[4]);
    expect(latest._compacted).toBeUndefined();
    expect(latest._truncated).toBeUndefined();
    // 更早的重复读仍被去重 meta 化
    expect(item(result.messages[1])._compacted).toBe(true);
    // pin 集合包含该路径
    expect(ledger.pinnedPaths.has('skills/SKILL.md')).toBe(true);
  });

  it('模型主动 pin 的路径,最新读取豁免压缩', () => {
    const big = 'line\n'.repeat(4000);
    const messages = [
      userMessage('read'),
      toolMessage('read_file', { path: 'core.ts', content: big, totalLines: 4000 }, 'tc-1'),
    ];
    const ledger = new ContextLedger();
    ledger.pin('core.ts'); // 模型声明这是核心文件

    const result = manageToolOutputLifecycle(
      messages,
      { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 },
      undefined,
      { ledger },
    );

    // pin 的最新读取保留完整,即使超大也不截断
    expect(item(result.messages[1])._compacted).toBeUndefined();
    expect(item(result.messages[1])._truncated).toBeUndefined();
  });

  it('release 后允许重新压缩', () => {
    const big = 'line\n'.repeat(4000);
    const messages = [
      userMessage('read'),
      toolMessage('read_file', { path: 'core.ts', content: big, totalLines: 4000 }, 'tc-1'),
    ];
    const ledger = new ContextLedger();
    ledger.pin('core.ts');
    ledger.release('core.ts'); // 解除

    const result = manageToolOutputLifecycle(
      messages,
      { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 0 },
      undefined,
      { ledger },
    );
    // release 后,当前步超大 -> 截断
    expect(item(result.messages[1])._truncated).toBe(true);
  });
});

describe('truncated -> meta 降级阶梯', () => {
  it('截断后的结果超出边界后可降级为 meta', () => {
    const big = 'line\n'.repeat(4000);
    const messages = [
      userMessage('read'),
      toolMessage('read_file', { path: 'a.ts', content: big, totalLines: 4000 }, 'tc-old'),
      userMessage('then'),
      toolMessage('read_file', { path: 'b.ts', content: 'small', totalLines: 1 }, 'tc-new'),
    ];
    const result = manageToolOutputLifecycle(messages, { ...DEFAULT_LIFECYCLE_CONFIG, keepRecentSteps: 1 });
    // tc-old 超出边界 -> 直接 meta(即便它本来会被截断,边界外优先 meta)
    expect(item(result.messages[1])._compacted).toBe(true);
  });
});

describe('ContextLedger 台账', () => {
  it('list 返回 pin 列表与最近压缩记录', () => {
    const ledger = new ContextLedger();
    ledger.pin('a.ts');
    ledger.recordCompaction({ toolName: 'read_file', path: 'b.ts', action: 'meta', originalSize: 10000, recovery: 're-read' });
    ledger.recordCompaction({ toolName: 'bash', toolCallId: 'tc-1', action: 'truncated', originalSize: 5000 });

    const out = ledger.formatLedger();
    expect(out).toContain('a.ts');
    expect(out).toContain('Pinned paths');
    expect(out).toContain('read_file');
    expect(out).toContain('b.ts');
    expect(out).toContain('truncated');
    expect(out).toContain('meta');
  });
});
