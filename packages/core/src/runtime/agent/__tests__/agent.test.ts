import { describe, it, expect, vi } from 'vitest';
import {
  resolveActiveSkills,
  loadMemoryContext,
  buildAgentInstructions,
} from '../context';
import type { Skill } from '../../../extensions/skills/types';

// Mock memory module since it has filesystem operations
vi.mock('../../../extensions/memory', () => ({
  findRelevantMemories: vi.fn(() => Promise.resolve([])),
  buildMemorySection: vi.fn(() => Promise.resolve('')),
  getUserMemoryDir: vi.fn((userId: string) => `/memory/${userId}`),
  ensureMemoryDirExists: vi.fn(() => Promise.resolve()),
}));

// Mock project context loading since it involves filesystem
vi.mock('../../../extensions/system-prompt/sections/project-context', () => ({
  loadProjectContext: vi.fn(() =>
    Promise.resolve({
      content: '',
      source: '',
      exists: false,
    })
  ),
}));

// Mock system-prompt builder
vi.mock('../../../extensions/system-prompt', () => ({
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
  describe('resolveActiveSkills', () => {
    // Skills are now invoked via Skill tool, not auto-resolved
    // resolveActiveSkills returns empty result in simplified design

    it('should return empty result (skills are now invoked via Skill tool)', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Help me with shadcn components' }] },
      ];
      const skills: Skill[] = [
        {
          name: 'shadcn',
          description: 'shadcn/ui component library guide',
          whenToUse: 'shadcn questions',
          body: 'shadcn body',
          allowedTools: ['read_file', 'edit_file'],
          model: 'fast',
          sourcePath: '/skills/shadcn/SKILL.md',
          effort: 'medium',
          context: 'inline',
          paths: [],
        },
      ];

      // In simplified design, resolveActiveSkills returns empty result
      // Skills are invoked by Agent via Skill tool when needed
      const result = await resolveActiveSkills(messages, skills);

      expect(result.activeSkillNames.size).toBe(0);
      expect(result.activeSkills).toEqual([]);
      expect(result.activeToolsWhitelist).toBeNull();
      expect(result.activeModelOverride).toBeNull();
    });

    it('should return empty result regardless of message content', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Create a Word document' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Sure' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Using docx skill' }] },
      ];
      const skills: Skill[] = [
        {
          name: 'docx',
          description: 'Word document creation',
          body: 'docx instructions',
          allowedTools: [],
          sourcePath: '/skills/docx/SKILL.md',
          effort: 'medium',
          context: 'inline',
          paths: [],
        },
      ];

      const result = await resolveActiveSkills(messages, skills);

      // Skills are NOT auto-activated - Agent must call Skill tool
      expect(result.activeSkillNames.size).toBe(0);
      expect(result.activeSkills).toEqual([]);
    });
  });

  describe('loadMemoryContext', () => {
    it('should return empty content when no memories found', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      ];

      const result = await loadMemoryContext(messages, 'user1');

      expect(result.userId).toBe('user1');
      expect(result.recalledMemoriesContent).toBe('');
    });

    it('should return user ID correctly', async () => {
      const messages: any[] = [];

      const result = await loadMemoryContext(messages, 'test-user');

      expect(result.userId).toBe('test-user');
    });
  });

  describe('buildAgentInstructions', () => {
    it('should build instructions without skills', async () => {
      const result = await buildAgentInstructions(null, null, {});

      expect(result).toContain('System prompt');
    });

    it('should build instructions without skill bodies (skills invoked via tool)', async () => {
      // Even with skill resolution, instructions don't include skill bodies
      // Skill bodies are returned by Skill tool when Agent invokes it
      const skillResolution = {
        activeSkillNames: new Set(['test']),
        activeSkills: [
          { name: 'test', body: 'Test skill body', allowedTools: [] },
        ],
        activeToolsWhitelist: null,
        activeModelOverride: null,
      };

      const result = await buildAgentInstructions(skillResolution, null, {});

      // Skill bodies are NOT included in instructions - Agent calls Skill tool
      expect(result).toContain('System prompt');
    });

    it('should build instructions with memory context', async () => {
      const memoryContext = {
        userId: 'user1',
        recalledMemoriesContent: 'Some memory content',
      };

      const result = await buildAgentInstructions(null, memoryContext, {});

      expect(result).toContain('System prompt');
    });
  });
});