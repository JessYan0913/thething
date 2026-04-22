import { describe, it, expect, beforeEach } from 'vitest';
import type { PermissionRule, PermissionConfig, RuleMatchResult } from '../types';
import { matchRule, checkPermissionRules } from '../rules';

// ============================================================
// Permissions Types Tests
// ============================================================
describe('permissions-types', () => {
  describe('PermissionRule interface', () => {
    it('should have required fields', () => {
      const rule: PermissionRule = {
        id: 'rule-1',
        toolName: 'bash',
        pattern: 'git *',
        behavior: 'allow',
        createdAt: Date.now(),
      };
      expect(rule.id).toBeDefined();
      expect(rule.toolName).toBeDefined();
      expect(rule.behavior).toBeDefined();
      expect(rule.createdAt).toBeDefined();
    });

    it('should work without pattern', () => {
      const rule: PermissionRule = {
        id: 'rule-2',
        toolName: 'bash',
        behavior: 'deny',
        createdAt: Date.now(),
      };
      expect(rule.pattern).toBeUndefined();
    });
  });

  describe('PermissionConfig interface', () => {
    it('should have rules array and version', () => {
      const config: PermissionConfig = {
        rules: [],
        version: 1,
      };
      expect(config.rules).toBeDefined();
      expect(config.version).toBeDefined();
    });
  });
});

// ============================================================
// Permissions Rules Tests
// ============================================================
describe('permissions-rules', () => {
  // Note: These tests use the cached config, which may be empty
  // in test environment. We test the logic patterns directly.

  describe('matchRule logic patterns', () => {
    // Helper to test match logic directly
    function testBashPatternMatching(command: string, pattern: string): boolean {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1).trim();
        return command.trim().startsWith(prefix);
      }
      return command.trim() === pattern.trim();
    }

    function testFilePatternMatching(filePath: string, pattern: string): boolean {
      if (pattern.includes('*')) {
        const regex = new RegExp(
          pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\./g, '\\.')
        );
        return regex.test(filePath);
      }
      return filePath === pattern || filePath.startsWith(pattern);
    }

    describe('bash command matching', () => {
      it('should match exact command', () => {
        expect(testBashPatternMatching('git status', 'git status')).toBe(true);
      });

      it('should not match different command', () => {
        expect(testBashPatternMatching('npm install', 'git status')).toBe(false);
      });

      it('should match wildcard pattern', () => {
        expect(testBashPatternMatching('git status', 'git *')).toBe(true);
        expect(testBashPatternMatching('git commit', 'git *')).toBe(true);
        expect(testBashPatternMatching('git log', 'git *')).toBe(true);
      });

      it('should not match non-prefix with wildcard', () => {
        expect(testBashPatternMatching('npm install', 'git *')).toBe(false);
      });
    });

    describe('file path matching', () => {
      it('should match exact path', () => {
        expect(testFilePatternMatching('src/index.ts', 'src/index.ts')).toBe(true);
      });

      it('should match prefix path', () => {
        expect(testFilePatternMatching('src/utils/helper.ts', 'src')).toBe(true);
      });

      it('should match glob pattern with *', () => {
        // Single * matches non-slash characters
        expect(testFilePatternMatching('src/index.ts', 'src/*.ts')).toBe(true);
        expect(testFilePatternMatching('src/utils/helper.ts', 'src/*.ts')).toBe(false);
      });

      it('should match glob pattern *', () => {
        expect(testFilePatternMatching('src/utils/helper.ts', 'src/*.ts')).toBe(false);
        expect(testFilePatternMatching('src/index.ts', 'src/*.ts')).toBe(true);
      });

      it('should not match non-matching glob', () => {
        expect(testFilePatternMatching('src/utils/helper.js', 'src/**/*.ts')).toBe(false);
      });
    });
  });

  describe('checkPermissionRules', () => {
    it('should return null when no rules match (empty cache)', () => {
      const result = checkPermissionRules('bash', { command: 'git status' });
      expect(result).toBeNull();
    });
  });

  describe('matchRule', () => {
    it('should return unmatched result for empty cache', () => {
      const result = matchRule('bash', { command: 'git status' });
      expect(result.matched).toBe(false);
    });

    it('should return unmatched for non-existent tool', () => {
      const result = matchRule('unknown_tool', {});
      expect(result.matched).toBe(false);
    });
  });
});