import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getToolOutputConfig,
  processToolOutput,
  createContentReplacementState,
} from '../tool-output-manager';

// ============================================================
// 8.8 agent 报告纳入 budget 持久化
// 见 docs/compaction-execution-plan.md 步骤 8.8
// ============================================================

describe('agent report budget config', () => {
  it('agent and parallel_agent have explicit persistence thresholds', () => {
    expect(getToolOutputConfig('agent').maxResultSizeChars).toBe(50_000);
    expect(getToolOutputConfig('parallel_agent').maxResultSizeChars).toBe(50_000);
  });

  it('a normal-sized agent report is not persisted', async () => {
    const state = createContentReplacementState();
    const smallReport = { success: true, summary: 'Done. Fixed 3 bugs.' };
    const result = await processToolOutput(smallReport, 'agent', 'agent-1', { state });
    expect(result.persisted).toBe(false);
  });

  it('an oversized agent report is persisted to disk with a preview', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-budget-'));
    try {
      const state = createContentReplacementState();
      const hugeReport = { success: true, summary: 'x'.repeat(60_000) };
      const result = await processToolOutput(hugeReport, 'agent', 'agent-2', {
        state,
        sessionId: 'sess-1',
        dataDir: dir,
      });
      expect(result.persisted).toBe(true);
      expect(result.filepath).toBeTruthy();
      // 上下文里只留预览/元信息,远小于原始大小
      expect(result.content.length).toBeLessThan(result.originalSize);
      expect(state.replacements.has('agent-2')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
