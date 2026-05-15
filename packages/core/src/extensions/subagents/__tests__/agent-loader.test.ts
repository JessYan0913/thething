import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { scanAgentDirs, registerBuiltinAgents, globalAgentRegistry } from '../index';
import { resolveAgentRoute } from '../router';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../../config/defaults';

async function createTempAgentProject(): Promise<{ root: string; agentDir: string }> {
  const root = path.join(tmpdir(), `thething-agents-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const agentDir = path.join(root, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'agents');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'test-agent.md'), `---
agentType: test-agent
description: 测试 Agent
tools:
  - read_file
  - grep
model: fast
maxTurns: 5
---
You are a test agent.
`, 'utf-8');
  return { root, agentDir };
}

describe('Agent Loader Integration', () => {
  let root: string | undefined;

  beforeEach(() => {
    globalAgentRegistry.clear();
    registerBuiltinAgents();
  });

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true }).catch(() => {});
      root = undefined;
    }
    globalAgentRegistry.clear();
  });

  it('keeps builtin agents registered', () => {
    const builtinAgents = globalAgentRegistry.getAll().filter(agent => agent.source === 'builtin');

    expect(builtinAgents.length).toBeGreaterThan(0);
    expect(builtinAgents.some(agent => agent.agentType === 'explore')).toBe(true);
    expect(builtinAgents.some(agent => agent.agentType === 'research')).toBe(true);
  });

  it(`loads custom agents from ${DEFAULT_PROJECT_CONFIG_DIR_NAME}/agents/`, async () => {
    const project = await createTempAgentProject();
    root = project.root;

    const customAgents = await scanAgentDirs(root, { dirs: [project.agentDir] });
    customAgents.forEach(agent => globalAgentRegistry.register(agent));

    const testAgent = customAgents.find(agent => agent.agentType === 'test-agent');
    expect(testAgent).toBeDefined();
    expect(testAgent?.description).toContain('测试 Agent');
    expect(testAgent?.tools).toContain('read_file');
    expect(testAgent?.tools).toContain('grep');
    expect(testAgent?.model).toBe('fast');
    expect(testAgent?.maxTurns).toBe(5);
  });

  it('routes to a loaded custom agent by explicit type', async () => {
    const project = await createTempAgentProject();
    root = project.root;

    const customAgents = await scanAgentDirs(root, { dirs: [project.agentDir] });
    customAgents.forEach(agent => globalAgentRegistry.register(agent));

    const route = resolveAgentRoute(
      { agentType: 'test-agent', task: '验证加载' },
      {
        parentTools: {},
        parentModel: {} as any,
        parentSystemPrompt: '',
        parentMessages: [],
        writerRef: { current: null },
        abortSignal: new AbortController().signal,
        toolCallId: 'test',
        recursionDepth: 0,
      },
    );

    expect(route.type).toBe('named');
    expect(route.definition.agentType).toBe('test-agent');
  });

  it('auto-routes builtin explore requests based on task keywords', () => {
    const route = resolveAgentRoute(
      { task: 'find the main entry file' },
      {
        parentTools: {},
        parentModel: {} as any,
        parentSystemPrompt: '',
        parentMessages: [],
        writerRef: { current: null },
        abortSignal: new AbortController().signal,
        toolCallId: 'test',
        recursionDepth: 0,
      },
    );

    expect(route.definition.agentType).toBe('explore');
    expect(route.reason).toContain('explore');
  });
});
