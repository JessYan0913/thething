import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createGrepTool } from '../grep';
import { createGlobTool } from '../glob';

// ============================================================
// 8.6 grep/glob 默认文本格式 + glob limit 降 + grep per-file 上限
// 见 docs/compaction-execution-plan.md 步骤 8.6
// ============================================================

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'grep-glob-'));
  // 一个文件里塞很多命中,用于验证 per-file 上限
  const manyHits = Array.from({ length: 30 }, (_, i) => `const target_${i} = ${i};`).join('\n');
  await writeFile(join(dir, 'many.ts'), manyHits);
  await writeFile(join(dir, 'one.ts'), 'const target_only = 1;\nconst other = 2;');
  // 为 glob limit 测试造 250 个文件
  await mkdir(join(dir, 'gen'), { recursive: true });
  for (let i = 0; i < 250; i++) {
    await writeFile(join(dir, 'gen', `f${i}.txt`), 'x');
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function runGrep(args: any) {
  const tool = createGrepTool({ cwd: dir });
  return tool.execute!(args, {} as any) as Promise<string>;
}

function runGlob(args: any) {
  const tool = createGlobTool({ cwd: dir });
  return tool.execute!(args, {} as any) as Promise<string>;
}

describe('grep default compact text format', () => {
  it('returns formattedOutput text instead of a matches array', async () => {
    const raw = await runGrep({ pattern: 'target', path: dir });
    const result = JSON.parse(raw);
    expect(typeof result.formattedOutput).toBe('string');
    expect(result.matches).toBeUndefined();
    // 紧凑格式:file: 行 + 缩进的 line: content
    expect(result.formattedOutput).toMatch(/\.ts:/);
    expect(result.formattedOutput).toMatch(/\d+: /);
  });

  it('caps matches per file and notes the omitted count', async () => {
    const raw = await runGrep({ pattern: 'target', path: dir, perFileLimit: 5 });
    const result = JSON.parse(raw);
    // many.ts 有 30 处命中,应只保留 5 条 + "more matches" 提示
    expect(result.formattedOutput).toContain('more matches in this file');
    // 该文件在输出里的 "  N: " 行不超过 perFileLimit
    const manyLines = result.formattedOutput
      .split('\n')
      .filter((l: string) => /^  \d+: .*target/.test(l));
    // one.ts 贡献 1 条 + many.ts 5 条 = 6
    expect(manyLines.length).toBeLessThanOrEqual(6);
  });

  it('still supports multi-line context format when context > 0', async () => {
    const raw = await runGrep({ pattern: 'target_only', path: dir, context: 1 });
    const result = JSON.parse(raw);
    expect(typeof result.formattedOutput).toBe('string');
    expect(result.formattedOutput).toContain('---');
  });
});

describe('glob default limit', () => {
  it('defaults to 200 and truncates a 250-file dir', async () => {
    const raw = await runGlob({ pattern: 'gen/*.txt' });
    const result = JSON.parse(raw);
    expect(result.count).toBe(200);
    expect(result.truncated).toBe(true);
    expect(result.totalCount).toBe(250);
  });

  it('honors an explicit higher limit', async () => {
    const raw = await runGlob({ pattern: 'gen/*.txt', limit: 300 });
    const result = JSON.parse(raw);
    expect(result.count).toBe(250);
    expect(result.truncated).toBe(false);
  });
});
