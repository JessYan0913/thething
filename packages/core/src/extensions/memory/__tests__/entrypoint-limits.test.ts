// ============================================================
// Task 9: Memory Entrypoint Limits Behavior Tests
// ============================================================
// 验收清单：
// 1. entrypointMaxLines 能限制 entrypoint 的行数
// 2. entrypointMaxBytes 能限制 entrypoint 的字节数
// 3. 追加和重建行为不会绕过限制
// 4. 默认值与覆盖值都能被单测验证
// ============================================================

import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, afterEach } from 'vitest';
import {
  appendToEntrypoint,
  rebuildEntrypoint,
  deleteMemoryFile,
  truncateEntrypointContent,
  ENTRYPOINT_NAME,
} from '../../../extensions/memory/memdir';
import { DEFAULT_MEMORY_ENTRYPOINT_LIMITS } from '../../../config/behavior';
import { buildBehaviorConfig } from '../../../config/behavior';

// ============================================================
// Helper: 创建临时记忆目录
// ============================================================

async function createTempMemoryDir(files?: Record<string, string>): Promise<string> {
  const dir = path.join(tmpdir(), `thething-mem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(dir, name);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }
  }
  return dir;
}

// ============================================================
// 1. entrypointMaxLines 能限制 entrypoint 的行数
// ============================================================

describe('1. entrypointMaxLines limits entrypoint line count', () => {
  it('truncateEntrypointContent respects custom maxLines', () => {
    const content = Array(20).fill('line content').join('\n');
    const result = truncateEntrypointContent(content, 5, 25_000);
    expect(result.split('\n').length).toBeLessThanOrEqual(5);
  });

  it('truncateEntrypointContent falls back to DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxLines', () => {
    const content = Array(250).fill('line').join('\n');
    const result = truncateEntrypointContent(content);
    expect(result.split('\n').length).toBeLessThanOrEqual(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxLines);
  });

  it('DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxLines equals 200', () => {
    expect(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxLines).toBe(200);
  });
});

// ============================================================
// 2. entrypointMaxBytes 能限制 entrypoint 的字节数
// ============================================================

describe('2. entrypointMaxBytes limits entrypoint byte size', () => {
  it('truncateEntrypointContent respects custom maxBytes', () => {
    const content = 'a'.repeat(30_000);
    const result = truncateEntrypointContent(content, 200, 500);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it('truncateEntrypointContent falls back to DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxBytes', () => {
    const content = 'a'.repeat(30_000);
    const result = truncateEntrypointContent(content);
    expect(result.length).toBeLessThanOrEqual(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxBytes);
  });

  it('DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxBytes equals 25_000', () => {
    expect(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxBytes).toBe(25_000);
  });

  it('truncateEntrypointContent truncates at newline boundary when possible', () => {
    const content = 'line1\n' + 'a'.repeat(30_000) + '\nline3';
    const result = truncateEntrypointContent(content, 200, 1000);
    // Should not split mid-line
    expect(result).not.toContain('line3');
  });
});

// ============================================================
// 3. 追加和重建行为不会绕过限制
// ============================================================

describe('3. Append and rebuild do not bypass limits', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('appendToEntrypoint applies limits and truncates', async () => {
    dir = await createTempMemoryDir({
      'MEMORY.md': '# MEMORY.md\n\n## 用户记忆 (user)\n\n',
    });
    await appendToEntrypoint(dir, {
      filename: 'test.md',
      name: 'Test',
      description: 'x'.repeat(200),
      type: 'user',
    }, { maxLines: 4, maxBytes: 120 });

    const content = await readFile(path.join(dir, ENTRYPOINT_NAME), 'utf-8');
    expect(content.split('\n').length).toBeLessThanOrEqual(4);
    expect(content.length).toBeLessThanOrEqual(120);
  });

  it('rebuildEntrypoint applies limits and truncates', async () => {
    dir = await createTempMemoryDir();
    await rebuildEntrypoint(dir, { maxLines: 3, maxBytes: 80 });

    const content = await readFile(path.join(dir, ENTRYPOINT_NAME), 'utf-8');
    expect(content.split('\n').length).toBeLessThanOrEqual(3);
    expect(content.length).toBeLessThanOrEqual(80);
  });

  it('deleteMemoryFile applies limits through rebuildEntrypoint', async () => {
    dir = await createTempMemoryDir({
      'MEMORY.md': '# MEMORY.md\n\n## 用户记忆 (user)\n\n- test\n\n',
      'memories/test.md': '# Test\ncontent',
    });
    await deleteMemoryFile(dir, 'test.md', { maxLines: 3, maxBytes: 80 });

    const content = await readFile(path.join(dir, ENTRYPOINT_NAME), 'utf-8');
    expect(content.split('\n').length).toBeLessThanOrEqual(3);
    expect(content.length).toBeLessThanOrEqual(80);
  });

  it('appendToEntrypoint without limits uses DEFAULT_MEMORY_ENTRYPOINT_LIMITS', async () => {
    dir = await createTempMemoryDir({
      'MEMORY.md': '# MEMORY.md\n\n',
    });
    // Append without explicit limits — should use defaults
    await appendToEntrypoint(dir, {
      filename: 'small.md',
      name: 'Small',
      description: 'A small entry',
      type: 'user',
    });

    const content = await readFile(path.join(dir, ENTRYPOINT_NAME), 'utf-8');
    // Content should be well under default limits
    expect(content.split('\n').length).toBeLessThanOrEqual(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxLines);
    expect(content.length).toBeLessThanOrEqual(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxBytes);
  });
});

// ============================================================
// 4. 默认值与覆盖值都能被验证
// ============================================================

describe('4. Default values and overrides are verifiable', () => {
  it('buildBehaviorConfig populates entrypointMaxLines from defaults', () => {
    const behavior = buildBehaviorConfig();
    expect(behavior.memory.entrypointMaxLines).toBe(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxLines);
  });

  it('buildBehaviorConfig populates entrypointMaxBytes from defaults', () => {
    const behavior = buildBehaviorConfig();
    expect(behavior.memory.entrypointMaxBytes).toBe(DEFAULT_MEMORY_ENTRYPOINT_LIMITS.maxBytes);
  });

  it('buildBehaviorConfig allows overriding entrypointMaxLines', () => {
    const behavior = buildBehaviorConfig({
      memory: {
        ...buildBehaviorConfig().memory,
        entrypointMaxLines: 50,
      },
    });
    expect(behavior.memory.entrypointMaxLines).toBe(50);
  });

  it('buildBehaviorConfig allows overriding entrypointMaxBytes', () => {
    const behavior = buildBehaviorConfig({
      memory: {
        ...buildBehaviorConfig().memory,
        entrypointMaxBytes: 10_000,
      },
    });
    expect(behavior.memory.entrypointMaxBytes).toBe(10_000);
  });

  it('truncateEntrypointContent preserves content under limits', () => {
    const content = 'Small content\nwith few lines';
    const result = truncateEntrypointContent(content, 200, 25_000);
    expect(result).toBe(content);
  });

  it('truncateEntrypointContent handles empty content', () => {
    const result = truncateEntrypointContent('', 200, 25_000);
    expect(result).toBe('');
  });
});