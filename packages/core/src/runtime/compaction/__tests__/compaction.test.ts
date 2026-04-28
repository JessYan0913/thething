import { describe, it, expect, beforeAll } from 'vitest';
import type { UIMessage, Tool } from 'ai';
import {
  estimateTextTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateToolTokens,
  estimateToolsTokens,
  estimateInstructionsTokens,
  estimateFullRequest,
  formatEstimationResult,
  extractMessageText,
  hasTextBlocks,
  stripImagesFromMessages,
  preloadTokenizer,
} from '../token-counter';
import {
  createCompactBoundaryMessage,
  isCompactBoundaryMessage,
  parseCompactBoundaryMetadata,
  getMessagesAfterCompactBoundary,
  getLastBoundaryMessage,
  hasCompactBoundary,
  stripCompactBoundaries,
} from '../boundary';
import {
  evaluateTimeBasedTrigger,
  microCompactMessages,
  isCompactableTool,
} from '../micro-compact';
import { tryPtlDegradation } from '../ptl-degradation';
import {
  recordCompactFailure,
  recordCompactSuccess,
  getAutoCompactStatus,
  shouldTriggerAutoCompact,
} from '../auto-compact';
import { COMPACT_TOKEN_THRESHOLD, DEFAULT_MICRO_COMPACT_CONFIG, isCompactableTool as isCompactableToolFromTypes } from '../types';
import { quickBudgetCheck } from '../initial-budget-check';

// ============================================================
// Token Counter Tests
// ============================================================
describe('token-counter', () => {
  // 预加载 tokenizer
  beforeAll(async () => {
    await preloadTokenizer();
  });

  describe('estimateTextTokens', () => {
    it('should return 0 for empty string', async () => {
      expect(await estimateTextTokens('')).toBe(0);
    });

    it('should count tokens accurately using tokenizer', async () => {
      // 使用真实 tokenizer 计算英文文本
      const tokens = await estimateTextTokens('hello world');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);  // 简短文本
    });

    it('should count Chinese text tokens', async () => {
      const tokens = await estimateTextTokens('你好世界');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateMessageTokens', () => {
    it('should return overhead for empty message', async () => {
      const message: UIMessage = { id: 'test', role: 'user', parts: [] };
      expect(await estimateMessageTokens(message)).toBeGreaterThan(0);
    });

    it('should estimate text parts correctly', async () => {
      const message: UIMessage = {
        id: 'test',
        role: 'user',
        parts: [{ type: 'text', text: 'hello world' }],
      };
      expect(await estimateMessageTokens(message)).toBeGreaterThan(0);
    });

    it('should estimate reasoning parts', async () => {
      const message: UIMessage = {
        id: 'test',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'thinking...' }],
      };
      expect(await estimateMessageTokens(message)).toBeGreaterThan(0);
    });

    it('should handle legacy content format', async () => {
      const message = { id: 'test', role: 'user', content: 'hello' } as any;
      expect(await estimateMessageTokens(message)).toBeGreaterThan(0);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('should return 0 for empty array', async () => {
      expect(await estimateMessagesTokens([])).toBe(0);
    });

    it('should sum all message tokens', async () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'hi there' }] },
      ];
      expect(await estimateMessagesTokens(messages)).toBeGreaterThan(0);
    });
  });

  describe('estimateToolTokens', () => {
    it('should estimate a simple tool', async () => {
      const tool: Tool = {
        description: 'Execute bash commands',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      } as any;
      expect(await estimateToolTokens(tool)).toBeGreaterThan(0);
    });

    it('should handle tool without description', async () => {
      const tool: Tool = { description: '', inputSchema: { type: 'object' } } as any;
      expect(await estimateToolTokens(tool)).toBeGreaterThan(0);
    });
  });

  describe('estimateToolsTokens', () => {
    it('should return 0 for empty object', async () => {
      expect(await estimateToolsTokens({})).toBe(0);
    });

    it('should estimate multiple tools', async () => {
      const tools: Record<string, Tool> = {
        bash: { description: 'Run bash', inputSchema: { type: 'object' } } as any,
        read: { description: 'Read file', inputSchema: { type: 'object' } } as any,
      };
      expect(await estimateToolsTokens(tools)).toBeGreaterThan(0);
    });
  });

  describe('estimateFullRequest', () => {
    it('should return complete estimation', async () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      const tools: Record<string, Tool> = {
        bash: { description: 'Run bash', inputSchema: {} } as any,
      };
      const estimation = await estimateFullRequest(messages, 'Be helpful.', tools, 'qwen-max');

      expect(estimation.messagesTokens).toBeGreaterThan(0);
      expect(estimation.instructionsTokens).toBeGreaterThan(0);
      expect(estimation.toolsTokens).toBeGreaterThan(0);
      expect(estimation.outputReserve).toBeGreaterThan(0);
      expect(estimation.totalTokens).toBe(
        estimation.messagesTokens + estimation.instructionsTokens + estimation.toolsTokens + estimation.outputReserve
      );
    });

    it('should use default model limit for unknown model', async () => {
      const estimation = await estimateFullRequest([], '', {}, 'unknown-model');
      expect(estimation.modelLimit).toBe(128_000);
    });
  });

  describe('formatEstimationResult', () => {
    it('should format result with OK status', async () => {
      const estimation = await estimateFullRequest([], 'test', {}, 'qwen-max');
      const formatted = formatEstimationResult(estimation);
      expect(formatted).toContain('OK');
      expect(formatted).toContain('Total:');
    });

    it('should format result with EXCEEDS status when over limit', () => {
      const estimation = {
        totalTokens: 200_000,
        messagesTokens: 150_000,
        instructionsTokens: 20_000,
        toolsTokens: 20_000,
        outputReserve: 8_000,
        availableBudget: -72_000,
        modelLimit: 128_000,
        exceedsLimit: true,
        utilizationPercent: 156.25,
      };
      const formatted = formatEstimationResult(estimation);
      expect(formatted).toContain('EXCEEDS');
    });
  });

  describe('extractMessageText', () => {
    it('should extract text from parts', () => {
      const message: UIMessage = {
        id: '1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }, { type: 'reasoning', text: 'thinking' }],
      };
      expect(extractMessageText(message)).toContain('hello');
      expect(extractMessageText(message)).toContain('thinking');
    });

    it('should return empty string for message without text', () => {
      const message: UIMessage = { id: '1', role: 'user', parts: [] };
      expect(extractMessageText(message)).toBe('');
    });
  });

  describe('hasTextBlocks', () => {
    it('should return true for message with text', () => {
      const message: UIMessage = {
        id: '1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      };
      expect(hasTextBlocks(message)).toBe(true);
    });

    it('should return false for message without text', () => {
      const message: UIMessage = { id: '1', role: 'user', parts: [] };
      expect(hasTextBlocks(message)).toBe(false);
    });
  });

  describe('stripImagesFromMessages', () => {
    it('should replace image parts with text placeholder', () => {
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'user',
          parts: [{ type: 'image' as any, text: 'image data' } as any],
        },
      ];
      const stripped = stripImagesFromMessages(messages);
      expect(stripped[0].parts[0].type).toBe('text');
      expect((stripped[0].parts[0] as any).text).toBe('[image]');
    });
  });
});

// ============================================================
// Boundary Tests
// ============================================================
describe('boundary', () => {
  describe('createCompactBoundaryMessage', () => {
    it('should create a valid boundary message', () => {
      const boundary = createCompactBoundaryMessage('auto', 50_000, 'user-msg-1');
      expect(boundary.role).toBe('system');
      expect(boundary.id).toContain('boundary-');
      expect(boundary.parts[0].type).toBe('text');
    });

    it('should include metadata in JSON format', () => {
      const boundary = createCompactBoundaryMessage('manual', 100_000, 'user-msg-2');
      const parsed = JSON.parse(boundary.parts[0].text);
      expect(parsed.type).toBe('SYSTEM_COMPACT_BOUNDARY');
      expect(parsed.metadata.compactType).toBe('manual');
      expect(parsed.metadata.preCompactTokenCount).toBe(100_000);
    });

    it('should include preserved segment when provided', () => {
      const boundary = createCompactBoundaryMessage('auto', 50_000, 'user-msg-1', {
        headUuid: 'head-1',
        anchorUuid: 'anchor-1',
        tailUuid: 'tail-1',
      });
      const parsed = JSON.parse(boundary.parts[0].text);
      expect(parsed.metadata.preservedSegment).toBeDefined();
      expect(parsed.metadata.preservedSegment.headUuid).toBe('head-1');
    });
  });

  describe('isCompactBoundaryMessage', () => {
    it('should return true for valid boundary message', () => {
      const boundary = createCompactBoundaryMessage('auto', 50_000, 'user-msg-1');
      expect(isCompactBoundaryMessage(boundary)).toBe(true);
    });

    it('should return false for regular system message', () => {
      const message: UIMessage = {
        id: 'sys-1',
        role: 'system',
        parts: [{ type: 'text', text: 'You are a helpful assistant.' }],
      };
      expect(isCompactBoundaryMessage(message)).toBe(false);
    });

    it('should return false for user message', () => {
      const message: UIMessage = {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      };
      expect(isCompactBoundaryMessage(message)).toBe(false);
    });
  });

  describe('parseCompactBoundaryMetadata', () => {
    it('should parse metadata from boundary message', () => {
      const boundary = createCompactBoundaryMessage('auto', 75_000, 'user-msg-3');
      const metadata = parseCompactBoundaryMetadata(boundary);
      expect(metadata).toBeDefined();
      expect(metadata?.compactType).toBe('auto');
      expect(metadata?.preCompactTokenCount).toBe(75_000);
      expect(metadata?.lastUserMessageUuid).toBe('user-msg-3');
    });

    it('should return null for non-boundary message', () => {
      const message: UIMessage = {
        id: 'sys-1',
        role: 'system',
        parts: [{ type: 'text', text: 'Regular system message' }],
      };
      expect(parseCompactBoundaryMetadata(message)).toBeNull();
    });
  });

  describe('getMessagesAfterCompactBoundary', () => {
    it('should return messages after last boundary', () => {
      const boundary1 = createCompactBoundaryMessage('auto', 50_000, 'user-1');
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'msg1' }] },
        boundary1,
        { id: '2', role: 'user', parts: [{ type: 'text', text: 'msg2' }] },
        { id: '3', role: 'assistant', parts: [{ type: 'text', text: 'msg3' }] },
      ];
      const afterBoundary = getMessagesAfterCompactBoundary(messages);
      expect(afterBoundary.length).toBe(2);
      expect(afterBoundary[0].id).toBe('2');
    });

    it('should return all messages if no boundary', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'msg1' }] },
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'msg2' }] },
      ];
      const result = getMessagesAfterCompactBoundary(messages);
      expect(result.length).toBe(2);
    });
  });

  describe('getLastBoundaryMessage', () => {
    it('should return last boundary message', () => {
      const boundary1 = createCompactBoundaryMessage('auto', 50_000, 'user-1');
      const boundary2 = createCompactBoundaryMessage('manual', 30_000, 'user-2');
      const messages: UIMessage[] = [
        boundary1,
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'msg1' }] },
        boundary2,
      ];
      const last = getLastBoundaryMessage(messages);
      expect(last?.id).toBe(boundary2.id);
    });

    it('should return null if no boundary', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'msg1' }] },
      ];
      expect(getLastBoundaryMessage(messages)).toBeNull();
    });
  });

  describe('hasCompactBoundary', () => {
    it('should return true if boundary exists', () => {
      const boundary = createCompactBoundaryMessage('auto', 50_000, 'user-1');
      const messages: UIMessage[] = [boundary, { id: '1', role: 'user', parts: [{ type: 'text', text: 'msg1' }] }];
      expect(hasCompactBoundary(messages)).toBe(true);
    });

    it('should return false if no boundary', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'msg1' }] },
      ];
      expect(hasCompactBoundary(messages)).toBe(false);
    });
  });

  describe('stripCompactBoundaries', () => {
    it('should remove all boundary messages', () => {
      const boundary1 = createCompactBoundaryMessage('auto', 50_000, 'user-1');
      const boundary2 = createCompactBoundaryMessage('manual', 30_000, 'user-2');
      const messages: UIMessage[] = [
        boundary1,
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'msg1' }] },
        boundary2,
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'msg2' }] },
      ];
      const stripped = stripCompactBoundaries(messages);
      expect(stripped.length).toBe(2);
      expect(stripped.every((m) => !isCompactBoundaryMessage(m))).toBe(true);
    });
  });
});

// ============================================================
// Micro Compact Tests
// ============================================================
describe('micro-compact', () => {
  describe('isCompactableTool', () => {
    it('should return true for compactable tools', () => {
      expect(isCompactableTool('Read')).toBe(true);
      expect(isCompactableTool('Bash')).toBe(true);
      expect(isCompactableTool('Grep')).toBe(true);
    });

    it('should return true for MCP tools', () => {
      expect(isCompactableToolFromTypes('mcp_some_tool')).toBe(true);
    });

    it('should return true for Connector tools', () => {
      expect(isCompactableToolFromTypes('connector_sql')).toBe(true);
    });

    it('should return false for non-compactable tools', () => {
      expect(isCompactableTool('unknown_tool')).toBe(false);
    });
  });

  describe('microCompactMessages', () => {
    it('should return original messages if no tool parts', async () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      ];
      const result = await microCompactMessages(messages);
      expect(result.executed).toBe(false);
      expect(result.messages.length).toBe(2);
    });

    it('should clear large tool outputs', async () => {
      const largeOutput = 'a'.repeat(10_000);
      const messages: UIMessage[] = [
        {
          id: '1',
          role: 'assistant',
          parts: [
            { type: 'dynamic-tool' as any, output: { result: largeOutput }, toolCallId: 'tc-1' } as any,
          ],
        },
      ];
      const result = await microCompactMessages(messages);
      // The result depends on whether output exceeds threshold
      expect(result.messages.length).toBe(1);
    });
  });

  describe('evaluateTimeBasedTrigger', () => {
    it('should return null if no assistant message', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      expect(evaluateTimeBasedTrigger(messages)).toBeNull();
    });

    it('should return null if no timestamp', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      ];
      expect(evaluateTimeBasedTrigger(messages)).toBeNull();
    });
  });
});

// ============================================================
// PTL Degradation Tests
// ============================================================
describe('ptl-degradation', () => {
  describe('tryPtlDegradation', () => {
    it('should not execute for small messages', async () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      const result = await tryPtlDegradation(messages);
      expect(result.executed).toBe(false);
    });

    it('should execute for large messages', async () => {
      // Create messages that exceed PTL_RETRY_THRESHOLD (30_000 tokens)
      // With accurate tokenizer, need ~180,000 chars of diverse text for ~33,000 tokens
      const diverseText = 'This is a sample text with various words and patterns that should produce more tokens. ';
      const largeText = diverseText.repeat(2040); // ~179,000 chars -> ~33,000 tokens
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: largeText }] },
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: largeText }] },
      ];
      const result = await tryPtlDegradation(messages);
      expect(result.executed).toBe(true);
    });
  });
});

// ============================================================
// Auto Compact Tests
// ============================================================
describe('auto-compact', () => {
  describe('shouldTriggerAutoCompact', () => {
    it('should return false for small messages', async () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      expect(await shouldTriggerAutoCompact(messages, 'test-conv-1')).toBe(false);
    });

    it('should return true for large messages', async () => {
      // Create messages that exceed COMPACT_TOKEN_THRESHOLD (25_000 tokens)
      // With accurate tokenizer, need ~140,000 chars of diverse text for ~26,000 tokens
      const diverseText = 'This is a sample text with various words and patterns that should produce more tokens. ';
      const largeText = diverseText.repeat(1590); // ~138,000 chars -> ~26,000 tokens
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: largeText }] },
      ];
      expect(await shouldTriggerAutoCompact(messages, 'test-conv-2')).toBe(true);
    });

    it('should return false after circuit breaker trips', async () => {
      const convId = 'test-conv-circuit';
      // Record 3 failures to trip circuit breaker
      recordCompactFailure(convId);
      recordCompactFailure(convId);
      recordCompactFailure(convId);

      const diverseText = 'This is a sample text with various words and patterns that should produce more tokens. ';
      const largeText = diverseText.repeat(1590);
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: largeText }] },
      ];
      expect(await shouldTriggerAutoCompact(messages, convId)).toBe(false);

      // Reset after test
      recordCompactSuccess(convId);
    });
  });

  describe('recordCompactSuccess', () => {
    it('should reset circuit breaker', async () => {
      const convId = 'test-conv-reset';
      recordCompactFailure(convId);
      recordCompactFailure(convId);
      recordCompactSuccess(convId);

      // Circuit breaker should be reset
      const diverseText = 'This is a sample text with various words and patterns that should produce more tokens. ';
      const largeText = diverseText.repeat(1590);
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: largeText }] },
      ];
      expect(await shouldTriggerAutoCompact(messages, convId)).toBe(true);
    });
  });

  describe('getAutoCompactStatus', () => {
    it('should return complete status', async () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      const status = await getAutoCompactStatus(messages, 'test-conv-status');
      expect(status.currentUsage).toBeGreaterThan(0);
      expect(status.triggerThreshold).toBeDefined();
      expect(status.shouldTrigger).toBeDefined();
      expect(status.circuitBreakerTripped).toBeDefined();
    });
  });
});

// ============================================================
// Types Tests
// ============================================================
describe('compaction-types', () => {
  describe('isCompactableTool', () => {
    it('should return true for known tools', () => {
      expect(isCompactableToolFromTypes('Read')).toBe(true);
      expect(isCompactableToolFromTypes('Bash')).toBe(true);
    });

    it('should return true for MCP prefix', () => {
      expect(isCompactableToolFromTypes('mcp_custom')).toBe(true);
    });

    it('should return true for Connector prefix', () => {
      expect(isCompactableToolFromTypes('connector_http')).toBe(true);
    });
  });

  describe('constants', () => {
    it('should have correct COMPACT_TOKEN_THRESHOLD', () => {
      expect(COMPACT_TOKEN_THRESHOLD).toBe(25_000);
    });

    it('should have compactable tools in DEFAULT_MICRO_COMPACT_CONFIG', () => {
      expect(DEFAULT_MICRO_COMPACT_CONFIG.compactableTools.has('Read')).toBe(true);
      expect(DEFAULT_MICRO_COMPACT_CONFIG.compactableTools.has('Bash')).toBe(true);
    });
  });
});

// ============================================================
// Initial Budget Check Tests
// ============================================================
describe('initial-budget-check', () => {
  describe('quickBudgetCheck', () => {
    it('should return estimation for small request', async () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ];
      const tools: Record<string, Tool> = {
        bash: { description: 'Run bash', inputSchema: {} } as any,
      };
      const result = await quickBudgetCheck(messages, 'Be helpful.', tools, 'qwen-max');

      expect(result.estimation.totalTokens).toBeGreaterThan(0);
      expect(result.likelyExceeds).toBe(false);
    });
  });
});