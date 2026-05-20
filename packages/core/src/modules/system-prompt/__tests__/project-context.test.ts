import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { clearProjectContextCache, loadProjectContext } from '../sections/project-context';

describe('project context layout options', () => {
  it('loads configured context file names instead of hard-coded defaults', async () => {
    const root = path.join(tmpdir(), `thething-context-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'CUSTOM.md'), 'custom context', 'utf-8');
    await writeFile(path.join(root, 'THING.md'), 'default context', 'utf-8');

    clearProjectContextCache();
    const context = await loadProjectContext(root, {
      contextFileNames: ['CUSTOM.md'],
      configDirName: '.custom',
    });

    expect(context.combinedContent).toContain('custom context');
    expect(context.combinedContent).not.toContain('default context');
  });
});
