import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { BUNDLED_SKILLS } from '../bundled';
import { SkillFrontmatterSchema, DEFAULT_SKILL_LOADER_CONFIG } from '../types';

// ============================================================
// Skills Types Tests
// ============================================================
describe('skills-types', () => {
  describe('SkillFrontmatterSchema', () => {
    it('accepts standard minimal frontmatter without injecting extensions', () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: 'minimal-skill',
        description: 'Processes minimal examples when a user asks for a minimal skill.',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: 'minimal-skill',
          description: 'Processes minimal examples when a user asks for a minimal skill.',
        });
      }
    });

    it('accepts optional TheThing compatibility extensions', () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: 'test-skill',
        description: 'Runs tests when the user asks to validate a skill.',
        id: 'legacy-id',
        whenToUse: 'When testing',
        allowedTools: ['bash', 'read'],
        model: 'qwen-max',
        effort: 'max',
        context: 'fork',
        agent: 'general-purpose',
        background: false,
        paths: ['src/'],
      });

      expect(result.success).toBe(true);
    });

    it('accepts a 64-character name and rejects a 65-character name', () => {
      expect(SkillFrontmatterSchema.safeParse({
        name: 'a'.repeat(64),
        description: 'Valid description.',
      }).success).toBe(true);

      expect(SkillFrontmatterSchema.safeParse({
        name: 'a'.repeat(65),
        description: 'Valid description.',
      }).success).toBe(false);
    });

    it.each([
      '',
      'Uppercase',
      'under_score',
      'has space',
      '中文技能',
      'skill.name',
    ])('rejects non-standard skill name %j', (name) => {
      expect(SkillFrontmatterSchema.safeParse({
        name,
        description: 'Valid description.',
      }).success).toBe(false);
    });

    it.each(['anthropic-helper', 'my-claude-skill', 'claude'])('rejects reserved skill name %j', (name) => {
      expect(SkillFrontmatterSchema.safeParse({
        name,
        description: 'Valid description.',
      }).success).toBe(false);
    });

    it('rejects XML tags in the name or description', () => {
      expect(SkillFrontmatterSchema.safeParse({
        name: '<skill>',
        description: 'Valid description.',
      }).success).toBe(false);

      expect(SkillFrontmatterSchema.safeParse({
        name: 'safe-skill',
        description: 'Use <tool> when asked.',
      }).success).toBe(false);
    });

    it('trims descriptions and rejects empty or whitespace-only descriptions', () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: 'safe-skill',
        description: '  Runs safely when requested.  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe('Runs safely when requested.');
      }

      for (const description of ['', '   \n\t']) {
        expect(SkillFrontmatterSchema.safeParse({
          name: 'safe-skill',
          description,
        }).success).toBe(false);
      }
    });

    it('accepts a 1024-character description and rejects a 1025-character description', () => {
      expect(SkillFrontmatterSchema.safeParse({
        name: 'safe-skill',
        description: 'a'.repeat(1024),
      }).success).toBe(true);

      expect(SkillFrontmatterSchema.safeParse({
        name: 'safe-skill',
        description: 'a'.repeat(1025),
      }).success).toBe(false);
    });

    it('rejects invalid compatibility extension values', () => {
      expect(SkillFrontmatterSchema.safeParse({
        name: 'skill-name',
        description: 'Valid description.',
        effort: 'invalid',
      }).success).toBe(false);

      expect(SkillFrontmatterSchema.safeParse({
        name: 'skill-name',
        description: 'Valid description.',
        context: 'invalid',
      }).success).toBe(false);
    });

    it.each(['low', 'medium', 'high', 'xhigh', 'max'])('accepts compatibility effort %s', (effort) => {
      expect(SkillFrontmatterSchema.safeParse({
        name: 'skill',
        description: 'Valid description.',
        effort,
      }).success).toBe(true);
    });

    it.each(['inline', 'fork'])('accepts compatibility context %s', (context) => {
      expect(SkillFrontmatterSchema.safeParse({
        name: 'skill',
        description: 'Valid description.',
        context,
      }).success).toBe(true);
    });

    it('accepts agent and background fork extensions', () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: 'forked-skill',
        description: 'Delegates work when a user requests isolated execution.',
        context: 'fork',
        agent: 'general-purpose',
        background: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agent).toBe('general-purpose');
        expect(result.data.background).toBe(false);
      }
    });
  });

  describe('bundled skill generation', () => {
    it('matches the create-skill SKILL.md source of truth', async () => {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const sourcePath = path.resolve(currentDir, '../../../skills-builtin/create-skill/SKILL.md');
      const source = await readFile(sourcePath, 'utf8');
      const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

      expect(match).not.toBeNull();
      const metadata = Object.fromEntries(
        match![1].split('\n').map((line) => {
          const separator = line.indexOf(':');
          return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
        }),
      );
      expect(BUNDLED_SKILLS).toEqual([expect.objectContaining({
        name: metadata.name,
        description: metadata.description,
        sourcePath: 'builtin:create-skill',
        source: 'builtin',
        body: match![2].replace(/^\n/, '').replace(/\s+$/, ''),
      })]);
      expect(match![2]).toContain('Validate the deliverable')
      expect(match![2]).toContain('Invoke the new Skill by its exact name with the skill tool')
      expect(match![2]).toContain('does not complete a Skill creation task')
    });
  });

  describe('constants', () => {
    it('should have correct default loader config', () => {
      expect(DEFAULT_SKILL_LOADER_CONFIG.maxSkills).toBe(100);
    });
  });
});
