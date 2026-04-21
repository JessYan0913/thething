import { describe, it, expect } from 'vitest';
import {
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
  truncateEntrypointContent,
} from '../memdir';

// ============================================================
// Memory Module Tests
// ============================================================
describe('memory', () => {
  describe('memdir', () => {
    describe('constants', () => {
      it('should have correct entrypoint name', () => {
        expect(ENTRYPOINT_NAME).toBe('MEMORY.md');
      });

      it('should have correct max lines', () => {
        expect(MAX_ENTRYPOINT_LINES).toBe(200);
      });

      it('should have correct max bytes', () => {
        expect(MAX_ENTRYPOINT_BYTES).toBe(25_000);
      });
    });

    describe('truncateEntrypointContent', () => {
      it('should not truncate small content', () => {
        const content = 'Small content\nwith few lines';
        const result = truncateEntrypointContent(content);
        expect(result).toBe(content);
      });

      it('should truncate by bytes', () => {
        const content = 'a'.repeat(30_000);
        const result = truncateEntrypointContent(content);
        expect(result.length).toBeLessThanOrEqual(MAX_ENTRYPOINT_BYTES);
      });

      it('should truncate at newline when truncating by bytes', () => {
        const content = 'line1\n' + 'a'.repeat(30_000) + '\nline2';
        const result = truncateEntrypointContent(content);
        // Should truncate at last newline within max bytes
        expect(result).not.toContain('line2');
      });

      it('should truncate by lines', () => {
        const lines = Array(250).fill('line content');
        const content = lines.join('\n');
        const result = truncateEntrypointContent(content);
        const resultLines = result.split('\n');
        expect(resultLines.length).toBeLessThanOrEqual(MAX_ENTRYPOINT_LINES);
      });

      it('should handle empty content', () => {
        const result = truncateEntrypointContent('');
        expect(result).toBe('');
      });

      it('should handle single line content', () => {
        const content = 'single line';
        const result = truncateEntrypointContent(content);
        expect(result).toBe('single line');
      });

      it('should preserve content under limits', () => {
        const lines = Array(100).fill('line content');
        const content = lines.join('\n');
        const result = truncateEntrypointContent(content);
        expect(result).toBe(content);
      });
    });
  });
});