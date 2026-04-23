import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveActiveSkills,
  formatActiveSkillBodies,
  loadMemoryContext,
  buildAgentInstructions,
} from '../context';
import type { Skill } from '../../../extensions/skills/types';
import type { SkillResolution } from '../types';

// Mock memory module since it has filesystem operations
vi.mock('../../../extensions/memory', () => ({
  findRelevantMemories: vi.fn(() => Promise.resolve([])),
  buildMemorySection: vi.fn(() => Promise.resolve('')),
  getUserMemoryDir: vi.fn((userId: string) => `/memory/${userId}`),
  ensureMemoryDirExists: vi.fn(() => Promise.resolve()),
}));

// Mock skill-search module with TF-IDF search
vi.mock('../../../extensions/skill-search', () => ({
  buildSkillIndex: vi.fn(() => Promise.resolve([])),
  computeIdf: vi.fn(() => new Map()),
  searchSkills: vi.fn((query: string, index: any[], options: any) => {
    // Simple mock: return skills whose name appears in query
    const minScore = options?.minScore ?? 0.30;
    const results: { name: string; description: string; score: number }[] = [];

    for (const entry of index) {
      if (query.toLowerCase().includes(entry.name.toLowerCase())) {
        results.push({
          name: entry.name,
          description: entry.description,
          score: 0.5, // High enough to pass minScore
        });
      }
    }

    return results.slice(0, options?.limit ?? 5);
  }),
  SKILL_DISCOVERY_CONFIG: {
    SEARCH_LIMIT: 5,
    AUTO_LOAD_MIN_SCORE: 0.30,
  },
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
    it('should return empty result when no user messages', async () => {
      const messages: any[] = [
        { role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
      ];
      const skills: Skill[] = [];

      const result = await resolveActiveSkills(messages, skills);

      expect(result.activeSkillNames.size).toBe(0);
      expect(result.activeSkills).toEqual([]);
      expect(result.activeToolsWhitelist).toBeNull();
      expect(result.activeModelOverride).toBeNull();
    });

    it('should return empty result when empty skills', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Help me' }] },
      ];
      const skills: Skill[] = [];

      const result = await resolveActiveSkills(messages, skills);

      expect(result.activeSkillNames.size).toBe(0);
      expect(result.activeSkills).toEqual([]);
    });

    it('should resolve skills based on TF-IDF search', async () => {
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

      // Mock index with skill entries
      const { buildSkillIndex } = await import('../../../extensions/skill-search');
      vi.mocked(buildSkillIndex).mockResolvedValueOnce([
        {
          name: 'shadcn',
          normalizedName: 'shadcn',
          description: 'shadcn/ui component library guide',
          source: 'project',
          sourcePath: '/skills/shadcn/SKILL.md',
          tokens: ['shadcn', 'component', 'ui'],
          tfVector: new Map(),
        },
      ]);

      const result = await resolveActiveSkills(messages, skills);

      expect(result.activeSkillNames.has('shadcn')).toBe(true);
      expect(result.activeSkills.length).toBe(1);
      expect(result.activeToolsWhitelist?.has('read_file')).toBe(true);
    });

    it('should collect allowed tools from active skills', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'I need help with test-skill' }] },
      ];
      const skills: Skill[] = [
        {
          name: 'test-skill',
          description: 'Test skill',
          body: 'test body',
          allowedTools: ['read_file', 'bash', 'edit_file'],
          sourcePath: '/skills/test/SKILL.md',
          effort: 'medium',
          context: 'inline',
          paths: [],
        },
      ];

      const { buildSkillIndex } = await import('../../../extensions/skill-search');
      vi.mocked(buildSkillIndex).mockResolvedValueOnce([
        {
          name: 'test-skill',
          normalizedName: 'test skill',
          description: 'Test skill',
          source: 'project',
          sourcePath: '/skills/test/SKILL.md',
          tokens: ['test', 'skill'],
          tfVector: new Map(),
        },
      ]);

      const result = await resolveActiveSkills(messages, skills);

      expect(result.activeToolsWhitelist?.size).toBe(3);
      expect(result.activeToolsWhitelist?.has('read_file')).toBe(true);
      expect(result.activeToolsWhitelist?.has('bash')).toBe(true);
      expect(result.activeToolsWhitelist?.has('edit_file')).toBe(true);
    });

    it('should return model override from active skill', async () => {
      const messages: any[] = [
        { role: 'user', parts: [{ type: 'text', text: 'Help with model-skill' }] },
      ];
      const skills: Skill[] = [
        {
          name: 'model-skill',
          description: 'Model skill',
          body: 'model body',
          allowedTools: [],
          model: 'opus',
          sourcePath: '/skills/model/SKILL.md',
          effort: 'high',
          context: 'inline',
          paths: [],
        },
      ];

      const { buildSkillIndex } = await import('../../../extensions/skill-search');
      vi.mocked(buildSkillIndex).mockResolvedValueOnce([
        {
          name: 'model-skill',
          normalizedName: 'model skill',
          description: 'Model skill',
          source: 'project',
          sourcePath: '/skills/model/SKILL.md',
          tokens: ['model', 'skill'],
          tfVector: new Map(),
        },
      ]);

      const result = await resolveActiveSkills(messages, skills);

      expect(result.activeModelOverride).toBe('opus');
    });
  });

  describe('formatActiveSkillBodies', () => {
    it('should return empty string for empty skills', () => {
      const result = formatActiveSkillBodies([]);
      expect(result).toBe('');
    });

    it('should format skill bodies correctly', () => {
      const skills = [
        { name: 'test', body: 'Test instruction' },
        { name: 'demo', body: 'Demo instruction' },
      ];

      const result = formatActiveSkillBodies(skills);

      expect(result).toContain('已激活技能');
      expect(result).toContain('<技能指令 name="test">');
      expect(result).toContain('Test instruction');
      expect(result).toContain('<技能指令 name="demo">');
      expect(result).toContain('Demo instruction');
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
  });

  describe('buildAgentInstructions', () => {
    it('should build instructions without skills', async () => {
      const result = await buildAgentInstructions(null, null, {});

      expect(result).toContain('System prompt');
    });

    it('should include skill bodies when skills are active', async () => {
      const skillResolution: SkillResolution = {
        activeSkillNames: new Set(['test']),
        activeSkills: [
          { name: 'test', body: 'Test skill body', allowedTools: [] },
        ],
        activeToolsWhitelist: null,
        activeModelOverride: null,
      };

      const result = await buildAgentInstructions(skillResolution, null, {});

      expect(result).toContain('已激活技能完整指令');
      expect(result).toContain('Test skill body');
    });
  });
});