// ============================================================
// Doctor Layout — resolveTheThingLayout 测试
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTheThingLayout } from '../layout';

const ORIG_HOME = process.env.THETHING_HOME_DIR;

describe('resolveTheThingLayout', () => {
  afterEach(() => {
    if (ORIG_HOME === undefined) delete process.env.THETHING_HOME_DIR;
    else process.env.THETHING_HOME_DIR = ORIG_HOME;
  });

  it('默认 ~/.thething + data 子目录', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-layout-'));
    try {
      process.env.THETHING_HOME_DIR = tmp;
      const layout = resolveTheThingLayout();
      expect(layout.configDir).toBe(path.join(tmp, '.thething'));
      expect(layout.dataDir).toBe(path.join(tmp, '.thething', 'data'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('尊重 ~/.thethingrc 的 dataDir 指针（~ 展开）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-layout-'));
    try {
      process.env.THETHING_HOME_DIR = tmp;
      fs.mkdirSync(path.join(tmp, '.thething'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.thethingrc'), JSON.stringify({ dataDir: '~/alt' }));
      const layout = resolveTheThingLayout();
      expect(layout.configDir).toBe(path.join(tmp, '.thething'));
      expect(layout.dataDir).toBe(path.join(tmp, 'alt', 'data'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
