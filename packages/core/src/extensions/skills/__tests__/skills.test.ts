import { describe, it, expect } from 'vitest';
import { SkillFrontmatterSchema, DEFAULT_SKILL_LOADER_CONFIG, DEFAULT_SKILL_SCAN_DIRS } from '../types';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../../config/defaults';

// ============================================================
// Skills Types Tests
// ============================================================
describe('skills-types', () => {
  describe('SkillFrontmatterSchema', () => {
    it('should validate valid frontmatter', () => {
      const validData = {
        name: 'test-skill',
        description: 'A test skill for testing',
        whenToUse: 'When testing',
        allowedTools: ['bash', 'read'],
        model: 'qwen-max',
        effort: 'medium',
        context: 'inline',
        paths: ['src/'],
      };
      const result = SkillFrontmatterSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should apply defaults for optional fields', () => {
      const minimalData = {
        name: 'minimal-skill',
        description: 'Minimal skill',
      };
      const result = SkillFrontmatterSchema.safeParse(minimalData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowedTools).toEqual([]);
        expect(result.data.effort).toBe('medium');
        expect(result.data.context).toBe('inline');
        expect(result.data.paths).toEqual([]);
      }
    });

    it('should reject empty name', () => {
      const invalidData = {
        name: '',
        description: 'Test',
      };
      const result = SkillFrontmatterSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject name over 50 chars', () => {
      const invalidData = {
        name: 'a'.repeat(51),
        description: 'Test',
      };
      const result = SkillFrontmatterSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty description', () => {
      const invalidData = {
        name: 'skill-name',
        description: '',
      };
      const result = SkillFrontmatterSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid effort', () => {
      const invalidData = {
        name: 'skill-name',
        description: 'Test',
        effort: 'invalid',
      };
      const result = SkillFrontmatterSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid context', () => {
      const invalidData = {
        name: 'skill-name',
        description: 'Test',
        context: 'invalid',
      };
      const result = SkillFrontmatterSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept valid effort values', () => {
      const efforts = ['low', 'medium', 'high'];
      for (const effort of efforts) {
        const data = {
          name: 'skill',
          description: 'Test',
          effort,
        };
        const result = SkillFrontmatterSchema.safeParse(data);
        expect(result.success).toBe(true);
      }
    });

    it('should accept valid context values', () => {
      const contexts = ['inline', 'fork'];
      for (const context of contexts) {
        const data = {
          name: 'skill',
          description: 'Test',
          context,
        };
        const result = SkillFrontmatterSchema.safeParse(data);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('constants', () => {
    it('should have correct default scan dirs', () => {
      expect(DEFAULT_SKILL_SCAN_DIRS).toContain(`${DEFAULT_PROJECT_CONFIG_DIR_NAME}/skills`);
    });

    it('should have correct default loader config', () => {
      expect(DEFAULT_SKILL_LOADER_CONFIG.scanDirs).toBeDefined();
      expect(DEFAULT_SKILL_LOADER_CONFIG.maxSkills).toBe(100);
    });
  });
});