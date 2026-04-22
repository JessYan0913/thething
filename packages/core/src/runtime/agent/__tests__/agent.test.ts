import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveActiveSkills,
  formatActiveSkillBodies,
  loadMemoryContext,
  buildAgentInstructions,
} from '../context';
import type { Skill } from '../../extensions/skills/types';
import type { SkillResolution } from '../types';

// Mock memory module since it has filesystem operations
vi.mock('../../extensions/memory', () => ({
  findRelevantMemories: vi.fn(() => Promise.resolve([])),
  buildMemorySection: vi.fn(() => Promise.resolve('')),
  getUserMemoryDir: vi.fn((userId: string) => `/memory/${userId}`),
  ensureMemoryDirExists: vi.fn(() => Promise.resolve()),
}));

// Mock skills determineActiveSkills with simple keyword matching
vi.mock('../../extensions/skills', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    determineActiveSkills: vi.fn((skills: Skill[], message: string) => {
      const active = new Set<string>();
      const lowerMessage = message.toLowerCase();
      for (const skill of skills) {
        if (skill.whenToUse && lowerMessage.includes(skill.name.toLowerCase())) {
          active.add(skill.name);
        }
      }
      return active;
    }),
  };
});

// Mock project context loading since it involves filesystem
vi.mock('../../extensions/system-prompt/sections/project-context', () => ({
  loadProjectContext: vi.fn(() =>
    Promise.resolve({
      content: '',
      source: '',
      exists: false,
    })
  ),
}));

describe('runtime/agent/context', () => {
  describe('resolveActiveSkills', () => {
    it('should return empty result when no user messages', () => {
      const messages: any[] = [
        { role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
      ];
      const skills: Skill[] = [];

      const result = resolveActiveSkills(messages, skills);

      expect(result.activeSkillNames.size).toBe(0);
      expect(result.activeSkills).toEqual([]);
      expect(result.activeToolsWhitelist).toBeNull();
      expect(result.activeModelOverride).toBeNull();
    });

    it('should resolve skills based on last user message', () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'I need help with ai-sdk' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'OK' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Help me with shadcn components' }] },
      ];
      const skills: Skill[] = [
        {
          name: 'ai-sdk',
          description: 'AI SDK guide',
          whenToUse: 'ai-sdk questions',
          body: 'AI SDK body',
          allowedTools: ['read_file', 'bash'],
          model: 'smart',
          sourcePath: '/skills/ai-sdk/SKILL.md',
        },
        {
          name: 'shadcn',
          description: 'shadcn guide',
          whenToUse: 'shadcn questions',
          body: 'shadcn body',
          allowedTools: ['read_file', 'edit_file'],
          model: 'fast',
          sourcePath: '/skills/shadcn/SKILL.md',
        },
      ];

      const result = resolveActiveSkills(messages, skills);

      // Should activate shadcn based on last user message
      expect(result.activeSkillNames.has('shadcn')).toBe(true);
      expect(result.activeSkillNames.has('ai-sdk')).toBe(false);
    });

    it('should collect allowed tools from active skills', () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'I need help with ai-sdk and shadcn' }] },
      ];
      const skills: Skill[] = [
        {
          name: 'ai-sdk',
          description: 'AI SDK guide',
          whenToUse: 'ai-sdk questions',
          body: 'AI SDK body',
          allowedTools: ['read_file', 'bash'],
          model: 'smart',
          sourcePath: '/skills/ai-sdk/SKILL.md',
        },
        {
          name: 'shadcn',
          description: 'shadcn guide',
          whenToUse: 'shadcn questions',
          body: 'shadcn body',
          allowedTools: ['read_file', 'edit_file', 'grep'],
          sourcePath: '/skills/shadcn/SKILL.md',
        },
      ];

      const result = resolveActiveSkills(messages, skills);

      expect(result.activeToolsWhitelist).toBeDefined();
      expect(result.activeToolsWhitelist?.has('read_file')).toBe(true);
      expect(result.activeToolsWhitelist?.has('bash')).toBe(true);
      expect(result.activeToolsWhitelist?.has('edit_file')).toBe(true);
      expect(result.activeToolsWhitelist?.has('grep')).toBe(true);
    });

    it('should get first model override from active skills', () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'I need help with ai-sdk' }] },
      ];
      const skills: Skill[] = [
        {
          name: 'ai-sdk',
          description: 'AI SDK guide',
          whenToUse: 'ai-sdk questions',
          body: 'AI SDK body',
          allowedTools: ['read_file'],
          model: 'smart',
          sourcePath: '/skills/ai-sdk/SKILL.md',
        },
      ];

      const result = resolveActiveSkills(messages, skills);

      expect(result.activeModelOverride).toBe('smart');
    });

    it('should not set model override when skill has no model', () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'I need help with test' }] },
      ];
      const skills: Skill[] = [
        {
          name: 'test',
          description: 'Test guide',
          whenToUse: 'test questions',
          body: 'Test body',
          allowedTools: ['read_file'],
          sourcePath: '/skills/test/SKILL.md',
        },
      ];

      const result = resolveActiveSkills(messages, skills);

      expect(result.activeModelOverride).toBeNull();
    });

    it('should handle multi-part user messages', () => {
      const messages: any[] = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'I need help' },
            { type: 'text', text: 'with ai-sdk' },
          ],
        },
      ];
      const skills: Skill[] = [
        {
          name: 'ai-sdk',
          description: 'AI SDK guide',
          whenToUse: 'ai-sdk questions',
          body: 'AI SDK body',
          allowedTools: ['read_file'],
          model: 'smart',
          sourcePath: '/skills/ai-sdk/SKILL.md',
        },
      ];

      const result = resolveActiveSkills(messages, skills);

      expect(result.activeSkillNames.has('ai-sdk')).toBe(true);
    });

    it('should ignore non-text parts', () => {
      const messages: any[] = [
        {
          role: 'user',
          parts: [
            { type: 'image', url: 'http://example.com/image.png' },
            { type: 'text', text: 'Help with shadcn' },
          ],
        },
      ];
      const skills: Skill[] = [
        {
          name: 'shadcn',
          description: 'shadcn guide',
          whenToUse: 'shadcn questions',
          body: 'shadcn body',
          allowedTools: ['read_file'],
          sourcePath: '/skills/shadcn/SKILL.md',
        },
      ];

      const result = resolveActiveSkills(messages, skills);

      expect(result.activeSkillNames.has('shadcn')).toBe(true);
    });
  });

  describe('formatActiveSkillBodies', () => {
    it('should return empty string for empty skills', () => {
      const result = formatActiveSkillBodies([]);
      expect(result).toBe('');
    });

    it('should format single skill', () => {
      const skills = [{ name: 'test-skill', body: 'Test skill body content' }];
      const result = formatActiveSkillBodies(skills);

      expect(result).toContain('test-skill');
      expect(result).toContain('Test skill body content');
      expect(result).toContain('<技能指令 name="test-skill">');
      expect(result).toContain('</技能指令>');
    });

    it('should format multiple skills', () => {
      const skills = [
        { name: 'skill-1', body: 'Body 1' },
        { name: 'skill-2', body: 'Body 2' },
      ];
      const result = formatActiveSkillBodies(skills);

      expect(result).toContain('skill-1');
      expect(result).toContain('skill-2');
      expect(result).toContain('Body 1');
      expect(result).toContain('Body 2');
    });

    it('should include activation notice', () => {
      const skills = [{ name: 'test', body: 'Test' }];
      const result = formatActiveSkillBodies(skills);

      expect(result).toContain('已激活技能完整指令');
      expect(result).toContain('请严格按照指令执行');
    });
  });

  describe('loadMemoryContext', () => {
    it('should return userId and empty content when no memories', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      ];

      const result = await loadMemoryContext(messages, 'user-123');

      expect(result.userId).toBe('user-123');
      expect(result.recalledMemoriesContent).toBe('');
    });

    it('should handle empty user message', async () => {
      const messages: any[] = [
        { role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
      ];

      const result = await loadMemoryContext(messages, 'user-456');

      expect(result.userId).toBe('user-456');
      expect(result.recalledMemoriesContent).toBe('');
    });
  });

  describe('buildAgentInstructions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should build instructions without skills', async () => {
      const result = await buildAgentInstructions(null, null);

      // The actual system prompt contains agent identity and behavior rules
      expect(result).toContain('身份定义');
      expect(result).toContain('Aura');
    });

    it('should append skill bodies when skills are active', async () => {
      const skillResolution: SkillResolution = {
        activeSkillNames: new Set(['test-skill']),
        activeSkills: [
          {
            name: 'test-skill',
            body: 'Test skill instructions',
            allowedTools: ['read_file'],
          },
        ],
        activeToolsWhitelist: new Set(['read_file']),
        activeModelOverride: null,
      };

      const result = await buildAgentInstructions(skillResolution, null);

      // Base prompt should contain identity
      expect(result).toContain('身份定义');
      // Skill bodies should be appended
      expect(result).toContain('test-skill');
      expect(result).toContain('Test skill instructions');
      expect(result).toContain('已激活技能完整指令');
    });

    it('should pass options and include project context', async () => {
      const skills: Skill[] = [
        {
          name: 'skill-1',
          description: 'Test',
          body: 'Body',
          allowedTools: [],
          sourcePath: '/skill.md',
        },
      ];

      const result = await buildAgentInstructions(null, null, {
        skills,
        projectContext: {
          content: 'Custom project context',
          source: 'CUSTOM.md',
          exists: true,
        },
      });

      // The result should still contain the base prompt
      expect(result).toContain('身份定义');
    });

    it('should not append skill bodies when no active skills', async () => {
      const skillResolution: SkillResolution = {
        activeSkillNames: new Set(),
        activeSkills: [],
        activeToolsWhitelist: null,
        activeModelOverride: null,
      };

      const result = await buildAgentInstructions(skillResolution, null);

      // Should have base prompt without skill bodies
      expect(result).toContain('身份定义');
      expect(result).not.toContain('已激活技能完整指令');
    });
  });
});