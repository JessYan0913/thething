import { mkdir, writeFile, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, afterEach } from 'vitest';
import {
  clearProjectContextCache,
  loadProjectContext,
  getCachedProjectContext,
} from '../../../extensions/system-prompt/sections/project-context';
import { resolveLayout } from '../../../config/layout';
import { bootstrap } from '../../../bootstrap';
import { createContext } from '../../app/context';

async function createTempProject(files: Record<string, string>): Promise<string> {
  const root = path.join(tmpdir(), `thething-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(root, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
  return root;
}

describe('context file reload semantics', () => {
  let root: string | undefined;

  afterEach(async () => {
    clearProjectContextCache();
    if (root) {
      await rm(root, { recursive: true, force: true }).catch(() => {});
      root = undefined;
    }
  });

  it('loads explicit contextFileNames and ignores defaults outside that list', async () => {
    root = await createTempProject({
      'CUSTOM.md': 'custom project context',
      'THING.md': 'default project context',
    });

    const context = await loadProjectContext(root, {
      contextFileNames: ['CUSTOM.md'],
      configDirName: '.test',
    });

    expect(context.combinedContent).toContain('custom project context');
    expect(context.combinedContent).not.toContain('default project context');
  });

  it('keeps default contextFileNames behavior when not overridden', async () => {
    root = await createTempProject({
      'THING.md': 'thing context',
      'CONTEXT.md': 'context file content',
      '.test.md': 'config-dir marker',
    });

    const context = await loadProjectContext(root, {
      configDirName: '.test',
    });

    expect(context.combinedContent).toContain('thing context');
    expect(context.combinedContent).toContain('context file content');
    expect(context.combinedContent).toContain('config-dir marker');
  });

  it('reload() preserves runtime layout instead of accepting per-reload cwd/dataDir overrides', async () => {
    const customDataDir = path.join(tmpdir(), `thething-data-${Date.now()}`);
    const runtime = await bootstrap({
      layout: {
        resourceRoot: path.join(tmpdir(), `thething-bootstrap-${Date.now()}`),
        dataDir: customDataDir,
      },
    });

    const ctx = await createContext({ runtime });
    const reloaded = await ctx.reload();

    expect(ctx.layout.dataDir).toBe(customDataDir);
    expect(reloaded.layout.dataDir).toBe(customDataDir);
    expect(reloaded.layout.resourceRoot).toBe(ctx.layout.resourceRoot);

    await runtime.dispose();
  });

  it('resolveLayout exposes frozen contextFileNames', () => {
    const layout = resolveLayout({
      resourceRoot: '/project',
      contextFileNames: ['README.md', 'GUIDE.md'],
    });

    expect(layout.contextFileNames).toEqual(['README.md', 'GUIDE.md']);
    expect(Object.isFrozen(layout.contextFileNames)).toBe(true);
    expect(() => { (layout.contextFileNames as unknown as string[]).push('MUTATED.md'); }).toThrow();
  });

  it('cache keys stay aligned between loadProjectContext and getCachedProjectContext', async () => {
    root = await createTempProject({
      'CUSTOM.md': 'custom cached content',
    });

    await loadProjectContext(root, {
      contextFileNames: ['CUSTOM.md'],
      configDirName: '.test',
    });

    expect(getCachedProjectContext(root, {
      contextFileNames: ['CUSTOM.md'],
      configDirName: '.test',
    })).toContain('custom cached content');

    expect(getCachedProjectContext(root, {
      contextFileNames: ['THING.md'],
      configDirName: '.test',
    })).toBeNull();
  });
});
