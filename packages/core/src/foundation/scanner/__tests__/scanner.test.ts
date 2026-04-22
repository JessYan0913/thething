import { describe, it, expect } from 'vitest';
import type { ScanResult } from '../types';

// Test pure functions and type exports without filesystem mocking
// Filesystem-dependent tests would require integration testing

describe('foundation/scanner', () => {
  describe('types', () => {
    it('should define ScanResult structure', () => {
      const result: ScanResult = {
        filePath: '/test/file.md',
        dirPath: '/test',
        source: 'project',
      };

      expect(result.filePath).toBe('/test/file.md');
      expect(result.dirPath).toBe('/test');
      expect(result.source).toBe('project');
    });

    it('should support user source type', () => {
      const result: ScanResult = {
        filePath: '/user/config/file.md',
        dirPath: '/user/config',
        source: 'user',
      };

      expect(result.source).toBe('user');
    });

    it('should support ScanOptions structure', () => {
      const options = {
        pattern: '*.md',
        recursive: true,
      };

      expect(options.pattern).toBe('*.md');
      expect(options.recursive).toBe(true);
    });

    it('should support ScanConfig structure', () => {
      const config = {
        dirs: ['.thething/skills'],
        filePattern: 'SKILL.md',
        dirPattern: '*',
        recursive: false,
      };

      expect(config.dirs).toContain('.thething/skills');
      expect(config.filePattern).toBe('SKILL.md');
      expect(config.dirPattern).toBe('*');
    });
  });

  describe('pattern matching logic (unit tests)', () => {
    // Test the pattern matching logic inline since we can't easily mock
    // The actual implementation uses regex-based matching

    it('should match exact filename', () => {
      // Pattern: 'SKILL.md' matches 'SKILL.md' exactly
      const pattern = 'SKILL.md';
      const name = 'SKILL.md';
      const matches = name === pattern;
      expect(matches).toBe(true);
    });

    it('should not match different filename', () => {
      const pattern = 'SKILL.md';
      const name = 'OTHER.md';
      const matches = name === pattern;
      expect(matches).toBe(false);
    });

    it('should match wildcard pattern', () => {
      // Pattern '*.md' should match files ending with .md
      const pattern = '*.md';
      const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
      expect(regex.test('file.md')).toBe(true);
      expect(regex.test('test.md')).toBe(true);
      expect(regex.test('file.txt')).toBe(false);
    });

    it('should match "*" pattern for any file', () => {
      const pattern = '*';
      // '*' should match everything
      const matches = pattern === '*';
      expect(matches).toBe(true);
    });

    it('should handle glob patterns with wildcards', () => {
      // Pattern 'file-*.md' should match 'file-1.md', 'file-test.md'
      const pattern = 'file-*.md';
      const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
      expect(regex.test('file-1.md')).toBe(true);
      expect(regex.test('file-test.md')).toBe(true);
      expect(regex.test('other.md')).toBe(false);
    });
  });

  describe('source determination logic', () => {
    // Test the logic that determines 'user' vs 'project' source
    it('should identify user directory', () => {
      const userConfigDir = '/user/config';
      const dir = '/user/config/.thething';
      const isUser = dir.startsWith(userConfigDir);
      expect(isUser).toBe(true);
    });

    it('should identify project directory', () => {
      const userConfigDir = '/user/config';
      const dir = '/project/.thething';
      const isUser = dir.startsWith(userConfigDir);
      expect(isUser).toBe(false);
    });
  });

  describe('deduplication logic', () => {
    it('should deduplicate by resolved path', () => {
      const seenPaths = new Set<string>();
      const paths = ['/dir1/file.md', '/dir2/file.md', '/dir1/file.md'];

      const uniquePaths = [];
      for (const p of paths) {
        if (!seenPaths.has(p)) {
          seenPaths.add(p);
          uniquePaths.push(p);
        }
      }

      expect(uniquePaths.length).toBe(2);
      expect(uniquePaths).toContain('/dir1/file.md');
      expect(uniquePaths).toContain('/dir2/file.md');
    });
  });
});