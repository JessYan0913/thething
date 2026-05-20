import { describe, it, expect } from 'vitest';
import { parseToolsList, ParseError } from '../frontmatter';
import { z } from 'zod';

describe('foundation/parser/frontmatter', () => {
  describe('ParseError', () => {
    it('should create error with zod validation errors', () => {
      const schema = z.object({ name: z.string().min(1) });
      const result = schema.safeParse({ name: '' });

      if (!result.success) {
        const error = new ParseError('/test/file.md', result.error);

        expect(error.name).toBe('ParseError');
        expect(error.filePath).toBe('/test/file.md');
        expect(error.zodError).toBe(result.error);
        expect(error.message).toContain('Invalid frontmatter');
        expect(error.message).toContain('/test/file.md');
      }
    });

    it('should create error with raw error', () => {
      const rawError = new Error('File not found');
      const error = new ParseError('/test/file.md', undefined, rawError);

      expect(error.name).toBe('ParseError');
      expect(error.filePath).toBe('/test/file.md');
      expect(error.rawError).toBe(rawError);
      expect(error.message).toContain('Failed to parse');
      expect(error.message).toContain('File not found');
    });

    it('should create error without details', () => {
      const error = new ParseError('/test/file.md');

      expect(error.name).toBe('ParseError');
      expect(error.filePath).toBe('/test/file.md');
      expect(error.message).toContain('Failed to parse');
    });

    it('should format zod errors in message', () => {
      const schema = z.object({
        name: z.string().min(1),
        count: z.number().positive(),
      });
      const result = schema.safeParse({ name: '', count: -1 });

      if (!result.success) {
        const error = new ParseError('/test.md', result.error);

        // Should include path information
        expect(error.message).toContain('name');
        expect(error.message).toContain('count');
      }
    });
  });

  describe('parseToolsList', () => {
    it('should return undefined for undefined input', () => {
      const result = parseToolsList(undefined);
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const result = parseToolsList('');
      expect(result).toBeUndefined();
    });

    it('should parse comma-separated string', () => {
      const result = parseToolsList('read, write, bash');
      expect(result).toEqual(['read', 'write', 'bash']);
    });

    it('should trim whitespace from tools', () => {
      const result = parseToolsList('read ,  write  ,  bash  ');
      expect(result).toEqual(['read', 'write', 'bash']);
    });

    it('should filter empty entries', () => {
      const result = parseToolsList('read,,bash,');
      expect(result).toEqual(['read', 'bash']);
    });

    it('should handle array input', () => {
      const result = parseToolsList(['read', 'write', 'bash']);
      expect(result).toEqual(['read', 'write', 'bash']);
    });

    it('should trim array entries', () => {
      const result = parseToolsList([' read ', '  write  ', 'bash']);
      expect(result).toEqual(['read', 'write', 'bash']);
    });

    it('should filter empty array entries', () => {
      const result = parseToolsList(['read', '', 'bash', '']);
      expect(result).toEqual(['read', 'bash']);
    });

    it('should handle single tool', () => {
      const result = parseToolsList('read');
      expect(result).toEqual(['read']);
    });

    it('should handle single tool in array', () => {
      const result = parseToolsList(['bash']);
      expect(result).toEqual(['bash']);
    });

    it('should handle whitespace-only entries', () => {
      const result = parseToolsList(['read', '   ', 'bash']);
      expect(result).toEqual(['read', 'bash']);
    });

    it('should handle Chinese tool names', () => {
      const result = parseToolsList(['工具1', '工具2']);
      expect(result).toEqual(['工具1', '工具2']);
    });

    it('should handle mixed input with special characters', () => {
      const result = parseToolsList('tool_1, tool-2, tool.3');
      expect(result).toEqual(['tool_1', 'tool-2', 'tool.3']);
    });
  });
});