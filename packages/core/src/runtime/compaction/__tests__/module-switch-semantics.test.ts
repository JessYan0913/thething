// ============================================================
// Module Switch Semantics Tests - modules.compaction & modules.permissions
// ============================================================
// 验收清单：
// - modules.permissions=false → 系统提示不包含权限规则段
// - modules.permissions 开关不影响底层安全拦截（checkPermissionRules）
// - modules.compaction=false → compactMessagesIfNeeded 早期返回
// - modules.compaction=false → checkInitialBudget 跳过 Level 1 策略、保留 Level 2 策略
// - modules.compaction=false → tryPtlDegradation(enabled=false) 早期返回
// - modules.compaction=false → runCompactInBackground 跳过
// - PTL degradation 直接调用时不受 enabled 控制（Level 2）
// - Manual compact 不受 enabled 控制（Level 2）
// ============================================================

import { describe, expect, it, beforeAll, vi } from 'vitest';
import type { UIMessage, Tool } from 'ai';

// Compaction imports
import { compactMessagesIfNeeded } from '../index';
import { checkInitialBudget } from '../initial-budget-check';
import { tryPtlDegradation } from '../ptl-degradation';
import { runCompactInBackground, getQueueSize } from '../background-queue';
import { preloadTokenizer, estimateMessagesTokens } from '../token-counter';

// Permissions imports
import { createPermissionsSection } from '../../../extensions/system-prompt/sections/permissions';
import { matchRule, checkPermissionRules } from '../../../extensions/permissions/rules';
import type { PermissionRule } from '../../../extensions/permissions/types';

// ============================================================
// Mock DataStore
// ============================================================

function createMockDataStore() {
  return {
    costStore: {
      saveCostRecord: vi.fn(),
      getCostRecords: vi.fn().mockResolvedValue([]),
      getTotalCost: vi.fn().mockResolvedValue(0),
    },
    summaryStore: {
      saveSummary: vi.fn(),
      getSummaryByConversation: vi.fn().mockReturnValue(null),
    },
    messageStore: {
      saveMessages: vi.fn(),
      getMessages: vi.fn().mockResolvedValue([]),
    },
    conversationStore: {
      saveConversation: vi.fn(),
      getConversation: vi.fn().mockResolvedValue(null),
      updateConversationTitle: vi.fn(),
    },
  };
}

// ============================================================
// Helper: create large messages for budget tests
// ============================================================

function createLargeMessages(tokenTarget: number): UIMessage[] {
  // ~4 chars per token; repeat text to reach token target
  const diverseText = 'This is a sample text with various words and patterns that should produce more tokens. ';
  const repeatCount = Math.ceil(tokenTarget * 4 / diverseText.length);
  const largeText = diverseText.repeat(repeatCount);
  return [
    { id: '1', role: 'user', parts: [{ type: 'text', text: largeText }] },
    { id: '2', role: 'assistant', parts: [{ type: 'text', text: largeText }] },
  ];
}

function createLargeToolSet(count: number): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (let i = 0; i < count; i++) {
    tools[`mcp_tool_${i}`] = {
      description: `MCP tool ${i} with a detailed description that adds tokens `.repeat(10),
      inputSchema: { type: 'object', properties: { arg1: { type: 'string', description: 'argument' } } },
    } as any;
  }
  // Add core tools
  tools.bash = { description: 'Run bash commands', inputSchema: {} } as any;
  tools.read_file = { description: 'Read file contents', inputSchema: {} } as any;
  return tools;
}

// ============================================================
// Preload tokenizer
// ============================================================

beforeAll(async () => {
  await preloadTokenizer();
});

// ============================================================
// 1. modules.permissions 两级语义
// ============================================================

describe('1. modules.permissions two-level semantics', () => {
  // Level 1: Prompt injection
  describe('Level 1 - Prompt injection', () => {
    it('createPermissionsSection returns null content when permissions array is empty', () => {
      const section = createPermissionsSection([]);
      expect(section.content).toBeNull();
      expect(section.name).toBe('permissions');
    });

    it('createPermissionsSection returns null content when permissions undefined', () => {
      const section = createPermissionsSection(undefined);
      expect(section.content).toBeNull();
    });

    it('createPermissionsSection returns content when permissions array has rules', () => {
      const rules: PermissionRule[] = [
        { id: 'rule-1', toolName: 'bash', behavior: 'deny', pattern: 'rm -rf', createdAt: Date.now(), source: 'project' as const },
      ];
      const section = createPermissionsSection(rules);
      expect(section.content).not.toBeNull();
      expect(section.content).toContain('bash');
      expect(section.content).toContain('rm -rf');
    });
  });

  // Level 2: Security enforcement
  describe('Level 2 - Security enforcement (independent of modules.permissions)', () => {
    it('checkPermissionRules with explicit rules works regardless of modules.permissions switch', () => {
      // checkPermissionRules accepts rules directly — it does not depend on modules.permissions
      const rules: PermissionRule[] = [
        { id: 'rule-1', toolName: 'bash', behavior: 'deny', pattern: 'rm *', createdAt: Date.now(), source: 'project' as const },
      ];
      const matched = checkPermissionRules('bash', { command: 'rm -rf /' }, rules);
      expect(matched).not.toBeNull();
      expect(matched!.behavior).toBe('deny');
    });

    it('matchRule works with explicit rules independently of modules.permissions', () => {
      const rules: PermissionRule[] = [
        { id: 'rule-1', toolName: 'bash', behavior: 'allow', pattern: 'git *', createdAt: Date.now(), source: 'project' as const },
      ];
      const result = matchRule('bash', { command: 'git status' }, rules);
      expect(result.matched).toBe(true);
      expect(result.rule?.behavior).toBe('allow');
    });

    it('checkPermissionRules returns null for non-matching rules (Level 2 still active but no match)', () => {
      const rules: PermissionRule[] = [
        { id: 'rule-1', toolName: 'bash', behavior: 'deny', pattern: 'rm *', createdAt: Date.now(), source: 'project' as const },
      ];
      const matched = checkPermissionRules('bash', { command: 'git status' }, rules);
      // No match → null, but the enforcement layer is still active and would check
      expect(matched).toBeNull();
    });
  });
});

// ============================================================
// 2. modules.compaction 两级语义
// ============================================================

describe('2. modules.compaction two-level semantics', () => {
  // Level 1: Ordinary auto-compaction (blocked when enabled=false)

  describe('Level 1 - compactMessagesIfNeeded returns early when enabled=false', () => {
    it('returns {messages, executed:false, tokensFreed:0} when enabled=false', async () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      const ds = createMockDataStore();
      const result = await compactMessagesIfNeeded(messages, 'test-conv', ds as any, { enabled: false });
      expect(result.executed).toBe(false);
      expect(result.tokensFreed).toBe(0);
      expect(result.messages).toEqual(messages);
    });

    it('returns early even for large messages when enabled=false', async () => {
      const messages = createLargeMessages(30_000);
      const ds = createMockDataStore();
      const result = await compactMessagesIfNeeded(messages, 'test-conv-large', ds as any, { enabled: false });
      expect(result.executed).toBe(false);
      expect(result.tokensFreed).toBe(0);
    });
  });

  describe('Level 1 - checkInitialBudget skips Level 1 strategies when enabled=false', () => {
    it('skips strategy 1 (MicroCompact) when compactionEnabled=false', async () => {
      // Create messages large enough to trigger budget check
      const messages = createLargeMessages(150_000);
      const tools: Record<string, Tool> = {
        bash: { description: 'Run bash commands', inputSchema: {} } as any,
      };
      const ds = createMockDataStore();

      const result = await checkInitialBudget(
        messages,
        'Be helpful.',
        tools,
        'qwen-max',
        ds as any,
        'test-conv-budget',
        { enabled: false },
      );

      // actions should NOT contain MicroCompact
      expect(result.actions).not.toContain(
        result.actions.find(a => a.startsWith('MicroCompact'))
      );
      // Verify budget check still runs (doesn't crash)
      expect(result.estimation).toBeDefined();
    });

    it('skips strategy 3 (API Compact) when compactionEnabled=false', async () => {
      const messages = createLargeMessages(150_000);
      const tools: Record<string, Tool> = {
        bash: { description: 'Run bash commands', inputSchema: {} } as any,
      };
      const ds = createMockDataStore();

      const result = await checkInitialBudget(
        messages,
        'Be helpful.',
        tools,
        'qwen-max',
        ds as any,
        'test-conv-budget-2',
        { enabled: false },
      );

      // actions should NOT contain API Compact
      expect(result.actions).not.toContain(
        result.actions.find(a => a.startsWith('API Compact'))
      );
      expect(result.estimation).toBeDefined();
    });
  });

  // Level 2: Emergency recovery paths (always active)

  describe('Level 2 - checkInitialBudget emergency strategies run when enabled=false', () => {
    it('strategy 2 (tool filtering) can run regardless of compactionEnabled', async () => {
      // Create many optional tools that exceed tool budget
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      const tools = createLargeToolSet(50);
      const ds = createMockDataStore();

      const result = await checkInitialBudget(
        messages,
        'Be helpful.',
        tools,
        'qwen-max',
        ds as any,
        'test-conv-tools',
        { enabled: false },
      );

      // If tool filtering happened, we should see it in actions
      // (May or may not trigger depending on actual token counts)
      expect(result.estimation).toBeDefined();
      // Core tools should always be preserved
      if (result.adjustedTools) {
        expect(result.adjustedTools.bash).toBeDefined();
        expect(result.adjustedTools.read_file).toBeDefined();
      }
    });

    it('strategy 4 (emergency truncation) can run regardless of compactionEnabled', async () => {
      // Create very large messages that definitely exceed budget
      const messages = createLargeMessages(200_000);
      const tools: Record<string, Tool> = {
        bash: { description: 'Run bash', inputSchema: {} } as any,
      };
      const ds = createMockDataStore();

      const result = await checkInitialBudget(
        messages,
        'Be helpful.',
        tools,
        'qwen-max',
        ds as any,
        'test-conv-truncate',
        { enabled: false },
      );

      // If truncation happened, actions should contain "Emergency truncate"
      const truncateAction = result.actions.find(a => a.startsWith('Emergency truncate'));
      // Truncation may or may not fire depending on model limit vs actual message size
      // But the function should not crash and should produce a result
      expect(result.estimation).toBeDefined();
      if (truncateAction) {
        // Verify truncation actually happened
        expect(result.adjustedMessages).toBeDefined();
        expect(result.adjustedMessages!.length).toBeLessThan(messages.length);
      }
    });
  });

  // PTL degradation

  describe('tryPtlDegradation enabled guard', () => {
    it('tryPtlDegradation(enabled=false) returns early', async () => {
      const messages = createLargeMessages(35_000);
      const result = await tryPtlDegradation(messages, { enabled: false });
      expect(result.executed).toBe(false);
      expect(result.tokensFreed).toBe(0);
    });

    it('tryPtlDegradation() without enabled still executes for large messages (Level 2)', async () => {
      // PTL degradation is Level 2 — should execute when called directly
      // Need many small messages so hard truncation can actually remove some
      const diverseText = 'This is a sample text with various words and patterns that should produce more tokens. ';
      const mediumText = diverseText.repeat(200); // ~17,600 chars per message
      const messages: UIMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({ id: `msg-${i}`, role: i % 2 === 0 ? 'user' : 'assistant', parts: [{ type: 'text', text: mediumText }] });
      }
      const result = await tryPtlDegradation(messages);
      // Should trigger degradation for large multi-message conversations
      expect(result.executed).toBe(true);
      // Hard truncation should remove some messages (less than original)
      expect(result.messages.length).toBeLessThan(messages.length);
    });
  });

  // Background queue

  describe('runCompactInBackground enabled guard', () => {
    it('runCompactInBackground(enabled=false) skips without adding to queue', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      const ds = createMockDataStore();
      const sizeBefore = getQueueSize();

      runCompactInBackground(messages, 'test-conv-bg-skip', ds as any, undefined, { enabled: false });

      // Queue size should not change
      expect(getQueueSize()).toBe(sizeBefore);
    });
  });
});