import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createReadFileTool, type ReadFileOperations } from '../read';
import { createWriteFileTool } from '../write';
import { createEditFileTool } from '../edit';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

async function execute(tool: any, input: unknown): Promise<any> {
  return tool.execute(input, { toolCallId: 'test', messages: [] });
}

function readOperations(overrides: Partial<ReadFileOperations> = {}): ReadFileOperations {
  return {
    access: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ isFile: () => true })),
    readFile: vi.fn(async () => Buffer.from('hello')),
    detectImageMimeType: vi.fn(async () => null),
    ...overrides,
  };
}

describe('file tools structured errors', () => {
  it('read_file returns File not found when access fails with ENOENT', async () => {
    const tool = createReadFileTool({
      cwd: process.cwd(),
      operations: readOperations({ access: vi.fn(async () => { throw errno('ENOENT'); }) }),
    });

    const result = await execute(tool, { filePath: 'missing.txt' });

    expect(result).toMatchObject({ error: true, path: 'missing.txt' });
    expect(result.message).toContain('File not found');
  });

  it('read_file returns a directory error without reading contents', async () => {
    const readFile = vi.fn(async () => Buffer.from('should not be read'));
    const tool = createReadFileTool({
      cwd: process.cwd(),
      operations: readOperations({
        stat: vi.fn(async () => ({ isFile: () => false })),
        readFile,
      }),
    });

    const result = await execute(tool, { filePath: 'folder' });

    expect(result.message).toContain('Path is a directory, not a file');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('read_file catches a read race after access/stat succeeded', async () => {
    const tool = createReadFileTool({
      cwd: process.cwd(),
      operations: readOperations({ readFile: vi.fn(async () => { throw errno('ENOENT'); }) }),
    });

    const result = await execute(tool, { filePath: 'vanished.txt' });

    expect(result).toMatchObject({ error: true, path: 'vanished.txt' });
    expect(result.message).toContain('File not found');
  });

  it('write_file reports an existing target in create mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'file-errors-'));
    try {
      await writeFile(join(dir, 'existing.txt'), 'original');
      const tool = createWriteFileTool({ cwd: dir });

      const result = await execute(tool, {
        filePath: 'existing.txt',
        content: 'replacement',
        mode: 'create',
      });

      expect(result).toMatchObject({ error: true, path: 'existing.txt' });
      expect(result.message).toContain('文件已存在');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('write_file reports a directory target instead of throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'file-errors-'));
    try {
      await mkdir(join(dir, 'folder'));
      const tool = createWriteFileTool({ cwd: dir });

      const result = await execute(tool, {
        filePath: 'folder',
        content: 'content',
        mode: 'overwrite',
      });

      expect(result).toMatchObject({ error: true, path: 'folder' });
      expect(result.message).toContain('Path is a directory');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('edit_file returns structured validation errors', async () => {
    const tool = createEditFileTool({
      cwd: process.cwd(),
      operations: {
        access: vi.fn(async () => undefined),
        readFile: vi.fn(async () => Buffer.from('hello world')),
        writeFile: vi.fn(async () => undefined),
      },
    });

    const result = await execute(tool, {
      filePath: 'sample.txt',
      edits: [{ oldText: 'absent', newText: 'replacement' }],
    });

    expect(result).toMatchObject({ error: true, path: 'sample.txt' });
    expect(result.message).toContain('oldText not found');
  });

  it('edit_file returns structured write failures', async () => {
    const tool = createEditFileTool({
      cwd: process.cwd(),
      operations: {
        access: vi.fn(async () => undefined),
        readFile: vi.fn(async () => Buffer.from('hello world')),
        writeFile: vi.fn(async () => { throw errno('ENOSPC'); }),
      },
    });

    const result = await execute(tool, {
      filePath: 'sample.txt',
      edits: [{ oldText: 'world', newText: 'there' }],
    });

    expect(result).toMatchObject({ error: true, path: 'sample.txt' });
    expect(result.message).toContain('Disk full');
  });

  it('write_file blocks files inside a managed Wiki directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'file-errors-'));
    const wikiDir = join(dir, 'wiki');
    try {
      const tool = createWriteFileTool({ cwd: dir, protectedWritePaths: [wikiDir] });
      const result = await execute(tool, {
        filePath: 'wiki/page.md',
        content: 'bypass',
      });

      expect(result).toMatchObject({ error: true, path: 'wiki/page.md' });
      expect(result.message).toContain('Managed Wiki path');
      expect(result.message).toContain('save_wiki');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('edit_file blocks files inside a managed Wiki directory before reading', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'file-errors-'));
    const wikiDir = join(dir, 'wiki');
    const readFile = vi.fn(async () => Buffer.from('original'));
    try {
      const tool = createEditFileTool({
        cwd: dir,
        protectedWritePaths: [wikiDir],
        operations: {
          access: vi.fn(async () => undefined),
          readFile,
          writeFile: vi.fn(async () => undefined),
        },
      });
      const result = await execute(tool, {
        filePath: 'wiki/page.md',
        edits: [{ oldText: 'original', newText: 'bypass' }],
      });

      expect(result).toMatchObject({ error: true, path: 'wiki/page.md' });
      expect(result.message).toContain('Managed Wiki path');
      expect(readFile).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
