import { describe, it, expect, vi } from 'vitest';
import {
  loadMemoryContext,
  buildAgentInstructions,
} from '../context';

// Mock memory module since it has filesystem operations
vi.mock('../../../modules/memory', () => ({
  findRelevantMemories: vi.fn(() => Promise.resolve([])),
  buildMemorySection: vi.fn(() => Promise.resolve('')),
  getUserMemoryDir: vi.fn((userId: string) => `/memory/${userId}`),
  ensureMemoryDirExists: vi.fn(() => Promise.resolve()),
}));

// Mock project context loading since it involves filesystem
vi.mock('../../../modules/system-prompt/sections/project-context', () => ({
  loadProjectContext: vi.fn(() =>
    Promise.resolve({
      content: '',
      source: '',
      exists: false,
    })
  ),
}));

// Mock system-prompt builder
vi.mock('../../../modules/system-prompt', () => ({
  buildSystemPrompt: vi.fn(() =>
    Promise.resolve({
      prompt: 'System prompt',
      sections: [],
      includedSections: [],
      estimatedTokens: 100,
    })
  ),
}));

describe('runtime/agent/context', () => {
  describe('loadMemoryContext', () => {
    it('should return empty content when no memories found', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      ];

      const result = await loadMemoryContext(messages, 'user1', '/memory');

      expect(result.userId).toBe('user1');
      expect(result.recalledMemoriesContent).toBe('');
    });

    it('should return user ID correctly', async () => {
      const messages: any[] = [];

      const result = await loadMemoryContext(messages, 'test-user', '/memory');

      expect(result.userId).toBe('test-user');
    });
  });

  describe('buildAgentInstructions', () => {
    it('should build instructions without skills', async () => {
      const result = await buildAgentInstructions(null, {});

      expect(result).toContain('System prompt');
    });

    it('should build instructions without skill bodies (skills invoked via tool)', async () => {
      // Skill bodies are NOT included in instructions - Agent calls Skill tool
      const result = await buildAgentInstructions(null, {});

      expect(result).toContain('System prompt');
    });

    it('should build instructions with memory context', async () => {
      const memoryContext = {
        userId: 'user1',
        recalledMemoriesContent: 'Some memory content',
      };

      const result = await buildAgentInstructions(memoryContext, {});

      expect(result).toContain('System prompt');
    });
  });
});
