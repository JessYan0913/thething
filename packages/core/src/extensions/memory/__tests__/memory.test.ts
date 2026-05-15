import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { describe, it, expect } from 'vitest';
import { DEFAULT_MEMORY_ENTRYPOINT_LIMITS } from '../../../config/behavior';
import {
  ENTRYPOINT_NAME,
  appendToEntrypoint,
  rebuildEntrypoint,
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
        expect(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxLines).toBe(200);
      });

      it('should have correct max bytes', () => {
        expect(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxBytes).toBe(25_000);
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
        expect(result.length).toBeLessThanOrEqual(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxBytes);
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
        expect(resultLines.length).toBeLessThanOrEqual(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxLines);
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

    describe('entrypoint limits', () => {
      it('applies custom limits when appending to entrypoint', async () => {
        const memoryDir = path.join(tmpdir(), `thething-memory-${Date.now()}`);
        await mkdir(memoryDir, { recursive: true });
        await writeFile(path.join(memoryDir, ENTRYPOINT_NAME), '# MEMORY.md\n\n', 'utf-8');

        await appendToEntrypoint(memoryDir, {
          filename: 'user_long.md',
          name: 'Long memory',
          description: 'x'.repeat(200),
          type: 'user',
        }, {
          maxLines: 4,
          maxBytes: 120,
        });

        const content = await readFile(path.join(memoryDir, ENTRYPOINT_NAME), 'utf-8');
        expect(content.split('\n').length).toBeLessThanOrEqual(4);
        expect(content.length).toBeLessThanOrEqual(120);
      });

      it('applies custom limits when rebuilding entrypoint', async () => {
        const memoryDir = path.join(tmpdir(), `thething-memory-rebuild-${Date.now()}`);
        await mkdir(memoryDir, { recursive: true });

        await rebuildEntrypoint(memoryDir, {
          maxLines: 3,
          maxBytes: 80,
        });

        const content = await readFile(path.join(memoryDir, ENTRYPOINT_NAME), 'utf-8');
        expect(content.split('\n').length).toBeLessThanOrEqual(3);
        expect(content.length).toBeLessThanOrEqual(80);
      });
    });
  });
});
