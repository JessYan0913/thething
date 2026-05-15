import { mkdir, writeFile, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { bootstrap } from '../../../bootstrap';
import { createContext } from '../../app/context';
import { loadAll } from '../../loaders';

async function createTempProject(files: Record<string, string>): Promise<string> {
  const root = path.join(tmpdir(), `thething-snap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(root, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
  return root;
}

describe('AppContext snapshot', () => {
  let root: string;
  let runtime: Awaited<ReturnType<typeof bootstrap>>;
  let context: Awaited<ReturnType<typeof createContext>>;

  beforeEach(async () => {
    root = await createTempProject({});
    runtime = await bootstrap({
      layout: { resourceRoot: root },
    });
    context = await createContext({ runtime });
  });

  afterEach(async () => {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('freezes snapshot arrays and layout fields', () => {
    expect(() => { (context.skills as unknown as any[]).push({}); }).toThrow();
    expect(() => { (context.permissions as unknown as any[]).push({}); }).toThrow();
    expect(() => { (context.layout as { dataDir?: string }).dataDir = '/changed'; }).toThrow();
  });

  it('matches loadAll() result for the resolved layout', async () => {
    const loaded = await loadAll({
      cwd: root,
      resourceDirs: runtime.layout.resources,
    });

    expect(context.skills.length).toBe(loaded.skills.length);
    expect(context.agents.length).toBe(loaded.agents.length);
    expect(context.mcps.length).toBe(loaded.mcps.length);
    expect(context.connectors.length).toBe(loaded.connectors.length);
    expect(context.permissions.length).toBe(loaded.permissions.length);
    expect(context.memory.length).toBe(loaded.memory.length);
  });

  it('keeps connector registry synchronized with the snapshot', () => {
    const registryIds = runtime.connectorRegistry.getConnectorIds();
    const contextIds = context.connectors.map(connector => connector.id);
    expect(registryIds.sort()).toEqual(contextIds.sort());
  });

  it('reload() returns a new snapshot while preserving resolved layout', async () => {
    const nextContext = await context.reload();

    expect(nextContext).not.toBe(context);
    expect(nextContext.layout.resourceRoot).toBe(context.layout.resourceRoot);
    expect(nextContext.layout.dataDir).toBe(context.layout.dataDir);

    const registryIds = runtime.connectorRegistry.getConnectorIds();
    const contextIds = nextContext.connectors.map(connector => connector.id);
    expect(registryIds.sort()).toEqual(contextIds.sort());
  });

  it('resolveAgentConfig defaults dynamicReload=false and preserves explicit opt-in', async () => {
    const { resolveAgentConfig } = await import('../../app/resolve-agent-config');

    expect(resolveAgentConfig({
      context,
      conversationId: 'test-session',
      model: { apiKey: 'k', baseURL: 'https://b', modelName: 'm' },
    }).dynamicReload).toBe(false);

    expect(resolveAgentConfig({
      context,
      conversationId: 'test-session',
      model: { apiKey: 'k', baseURL: 'https://b', modelName: 'm' },
      dynamicReload: true,
    }).dynamicReload).toBe(true);
  });
});
