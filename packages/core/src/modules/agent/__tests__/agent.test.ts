import { describe, it, expect, vi } from 'vitest';
import {
  loadWikiContextForAgent,
  buildAgentInstructions,
} from '../context';

// Mock wiki module since it has filesystem operations
vi.mock('../../../modules/wiki', () => ({
  loadWikiContext: vi.fn(() => Promise.resolve({ indexContent: '', pages: [] })),
  formatWikiContextForPrompt: vi.fn(() => ''),
  ensureWikiDirExists: vi.fn(() => Promise.resolve()),
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
  describe('loadWikiContextForAgent', () => {
    it('should return empty content when no wiki pages found', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      ];

      const result = await loadWikiContextForAgent(messages, '/wiki');

      expect(result.recalledContent).toBe('');
    });

    it('should handle empty messages', async () => {
      const messages: any[] = [];

      const result = await loadWikiContextForAgent(messages, '/wiki');

      expect(result.recalledContent).toBe('');
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

    it('should build instructions with wiki context', async () => {
      const wikiContext = {
        userId: 'user1',
        recalledContent: 'Some wiki content',
      };

      const result = await buildAgentInstructions(wikiContext, {});

      expect(result).toContain('System prompt');
    });
  });
});
