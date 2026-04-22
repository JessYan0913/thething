import { describe, it, expect } from 'vitest';
import {
  determineActiveSkills,
  injectSkillsIntoPrompt,
  formatSkillMetadataOnly,
} from '../prompt-injection';
import type { Skill, SkillMetadata } from '../types';

// Helper to create complete Skill objects
function createSkill(overrides: Partial<Skill> & { name: string; description: string; body: string }): Skill {
  return {
    sourcePath: '/test.md',
    allowedTools: [],
    paths: [],
    effort: 'medium',
    context: 'inline',
    ...overrides,
  };
}

describe('skills/prompt-injection', () => {
  describe('determineActiveSkills', () => {
    it('should return empty set when no skills', () => {
      const result = determineActiveSkills([], 'help me with something');
      expect(result.size).toBe(0);
    });

    it('should return empty set when no whenToUse defined', () => {
      const skills: SkillMetadata[] = [
        { name: 'skill1', description: 'Test', allowedTools: [], paths: [], sourcePath: '/test.md' },
      ];
      const result = determineActiveSkills(skills, 'help me with skill1');
      expect(result.size).toBe(0);
    });

    it('should activate skill when keyword matches', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'ai-sdk',
          description: 'AI SDK guide',
          whenToUse: 'user asks about ai-sdk, vercel ai sdk, or ai integration',
          allowedTools: ['read_file'],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = determineActiveSkills(skills, 'How do I use ai-sdk?');
      expect(result.has('ai-sdk')).toBe(true);
    });

    it('should match case-insensitively', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'react',
          description: 'React guide',
          whenToUse: 'React, reactjs, react hooks',
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = determineActiveSkills(skills, 'I need help with REACT');
      expect(result.has('react')).toBe(true);
    });

    it('should not activate when stop words are in message', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'test-skill',
          description: 'Test',
          whenToUse: 'the', // 'the' is a stop word
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = determineActiveSkills(skills, 'the test message');
      expect(result.size).toBe(0);
    });

    it('should activate multiple skills', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'ai-sdk',
          description: 'AI SDK guide',
          whenToUse: 'ai-sdk, vercel ai',
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
        {
          name: 'shadcn',
          description: 'shadcn guide',
          whenToUse: 'shadcn, shadcn/ui',
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = determineActiveSkills(skills, 'Help me with ai-sdk and shadcn');
      expect(result.has('ai-sdk')).toBe(true);
      expect(result.has('shadcn')).toBe(true);
    });

    it('should extract keywords from whenToUse (comma separated)', () => {
      // Keywords should be extracted from comma-separated list
      const skills: SkillMetadata[] = [
        {
          name: 'database',
          description: 'Database guide',
          whenToUse: '数据库, mysql, postgres', // Use comma to separate
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = determineActiveSkills(skills, '帮我配置数据库');
      expect(result.has('database')).toBe(true);
    });

    it('should not match short keywords (< 2 chars)', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'short',
          description: 'Short keyword test',
          whenToUse: 'a, b, c', // All < 2 chars
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = determineActiveSkills(skills, 'a b c message');
      expect(result.size).toBe(0);
    });

    it('should handle Chinese whenToUse with comma separator', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'react',
          description: 'React guide',
          whenToUse: 'React, 组件, 开发', // Use comma to separate
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = determineActiveSkills(skills, 'React组件怎么写');
      expect(result.has('react')).toBe(true);
    });
  });

  describe('injectSkillsIntoPrompt', () => {
    it('should return original prompt when no skills', () => {
      const prompt = 'Original prompt';
      const result = injectSkillsIntoPrompt(prompt, [], new Set());
      expect(result).toBe(prompt);
    });

    it('should return original prompt when no active skills', () => {
      const prompt = 'Original prompt';
      const skills: Skill[] = [
        createSkill({
          name: 'skill1',
          description: 'Test',
          body: 'Body',
        }),
      ];
      const result = injectSkillsIntoPrompt(prompt, skills, new Set());
      expect(result).toBe(prompt);
    });

    it('should inject active skills into prompt', () => {
      const prompt = 'Original prompt';
      const skills: Skill[] = [
        createSkill({
          name: 'skill1',
          description: 'Skill 1',
          body: 'Skill 1 body content',
          allowedTools: ['read_file'],
        }),
        createSkill({
          name: 'skill2',
          description: 'Skill 2',
          body: 'Skill 2 body content',
          allowedTools: ['bash'],
        }),
      ];
      const activeSkillNames = new Set(['skill1']);
      const result = injectSkillsIntoPrompt(prompt, skills, activeSkillNames);

      expect(result).toContain('Original prompt');
      expect(result).toContain('已激活技能');
      expect(result).toContain('skill1');
      expect(result).toContain('Skill 1 body content');
      expect(result).not.toContain('skill2');
      expect(result).not.toContain('Skill 2 body content');
    });

    it('should inject multiple active skills', () => {
      const prompt = 'Original prompt';
      const skills: Skill[] = [
        createSkill({
          name: 'skill1',
          description: 'Skill 1',
          body: 'Body 1',
        }),
        createSkill({
          name: 'skill2',
          description: 'Skill 2',
          body: 'Body 2',
        }),
      ];
      const activeSkillNames = new Set(['skill1', 'skill2']);
      const result = injectSkillsIntoPrompt(prompt, skills, activeSkillNames);

      expect(result).toContain('skill1');
      expect(result).toContain('skill2');
      expect(result).toContain('Body 1');
      expect(result).toContain('Body 2');
    });

    it('should format skill with allowed tools', () => {
      const prompt = 'Original prompt';
      const skills: Skill[] = [
        createSkill({
          name: 'skill1',
          description: 'Skill 1',
          body: 'Body',
          allowedTools: ['bash', 'read_file', 'grep'],
        }),
      ];
      const activeSkillNames = new Set(['skill1']);
      const result = injectSkillsIntoPrompt(prompt, skills, activeSkillNames);

      expect(result).toContain('bash');
      expect(result).toContain('read_file');
      expect(result).toContain('grep');
    });

    it('should format skill with model recommendation', () => {
      const prompt = 'Original prompt';
      const skills: Skill[] = [
        createSkill({
          name: 'skill1',
          description: 'Skill 1',
          body: 'Body',
          model: 'smart',
        }),
      ];
      const activeSkillNames = new Set(['skill1']);
      const result = injectSkillsIntoPrompt(prompt, skills, activeSkillNames);

      expect(result).toContain('smart');
      expect(result).toContain('推荐模型');
    });

    it('should format skill with non-medium effort', () => {
      const prompt = 'Original prompt';
      const skills: Skill[] = [
        createSkill({
          name: 'skill1',
          description: 'Skill 1',
          body: 'Body',
          effort: 'high',
        }),
      ];
      const activeSkillNames = new Set(['skill1']);
      const result = injectSkillsIntoPrompt(prompt, skills, activeSkillNames);

      expect(result).toContain('深度执行');
    });

    it('should include skill body in skill directive tags', () => {
      const prompt = 'Original prompt';
      const skills: Skill[] = [
        createSkill({
          name: 'skill1',
          description: 'Skill 1',
          body: 'Skill instructions here',
        }),
      ];
      const activeSkillNames = new Set(['skill1']);
      const result = injectSkillsIntoPrompt(prompt, skills, activeSkillNames);

      expect(result).toContain('<技能指令>');
      expect(result).toContain('Skill instructions here');
      expect(result).toContain('</技能指令>');
    });
  });

  describe('formatSkillMetadataOnly', () => {
    it('should return empty string when no skills', () => {
      const result = formatSkillMetadataOnly([]);
      expect(result).toBe('');
    });

    it('should format skill metadata list', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'skill1',
          description: 'Skill 1 description',
          allowedTools: ['bash', 'read'],
          paths: [],
          sourcePath: '/test.md',
        },
        {
          name: 'skill2',
          description: 'Skill 2 description',
          allowedTools: [],
          paths: ['src/', 'lib/'],
          sourcePath: '/test.md',
        },
      ];
      const result = formatSkillMetadataOnly(skills);

      expect(result).toContain('可用技能');
      expect(result).toContain('skill1');
      expect(result).toContain('skill2');
      expect(result).toContain('Skill 1 description');
      expect(result).toContain('Skill 2 description');
    });

    it('should include whenToUse trigger condition', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'skill1',
          description: 'Skill 1',
          whenToUse: 'user asks about react',
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = formatSkillMetadataOnly(skills);

      expect(result).toContain('触发条件');
      expect(result).toContain('user asks about react');
    });

    it('should include model recommendation', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'skill1',
          description: 'Skill 1',
          model: 'fast',
          allowedTools: [],
          paths: [],
          sourcePath: '/test.md',
        },
      ];
      const result = formatSkillMetadataOnly(skills);

      expect(result).toContain('推荐模型');
      expect(result).toContain('fast');
    });

    it('should include paths', () => {
      const skills: SkillMetadata[] = [
        {
          name: 'skill1',
          description: 'Skill 1',
          allowedTools: [],
          paths: ['src/', 'lib/'],
          sourcePath: '/test.md',
        },
      ];
      const result = formatSkillMetadataOnly(skills);

      expect(result).toContain('适用路径');
      expect(result).toContain('src/');
      expect(result).toContain('lib/');
    });

    it('should show skill count', () => {
      const skills: SkillMetadata[] = [
        { name: 's1', description: 'D1', allowedTools: [], paths: [], sourcePath: '/test.md' },
        { name: 's2', description: 'D2', allowedTools: [], paths: [], sourcePath: '/test.md' },
        { name: 's3', description: 'D3', allowedTools: [], paths: [], sourcePath: '/test.md' },
      ];
      const result = formatSkillMetadataOnly(skills);

      expect(result).toContain('3 个技能');
    });
  });
});