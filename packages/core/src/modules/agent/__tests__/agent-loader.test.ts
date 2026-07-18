import os from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { scanAgentDirs, registerBuiltinAgents } from '../index';
import { AgentRegistry } from '../registry';
import { resolveAgentRoute } from '../router';

async function createTempAgentProject(): Promise<{ root: string; agentDir: string }> {
  const root = path.join(os.tmpdir(), `thething-agents-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const agentDir = path.join(root, '.thething', 'agents');
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
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
    registerBuiltinAgents(registry);
  });

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true }).catch(() => {});
      root = undefined;
    }
    registry.clear();
  });

  it('keeps builtin agents registered', () => {
    const builtinAgents = registry.getAll().filter(agent => agent.source === 'builtin');

    expect(builtinAgents.length).toBeGreaterThan(0);
    expect(builtinAgents.some(agent => agent.agentType === 'explore')).toBe(true);
    expect(builtinAgents.some(agent => agent.agentType === 'research')).toBe(true);
  });

  it('loads custom agents from .thething/agents/', async () => {
    const project = await createTempAgentProject();
    root = project.root;

    const customAgents = await scanAgentDirs(root, { dirs: [project.agentDir], configDir: path.join(os.homedir(), '.thething') });
    customAgents.forEach(agent => registry.register(agent));

    const testAgent = customAgents.find(agent => agent.agentType === 'test-agent');
    expect(testAgent).toBeDefined();
    expect(testAgent?.instructions).toContain('测试 Agent');
    expect(testAgent?.tools).toContain('read_file');
    expect(testAgent?.tools).toContain('grep');
    expect(testAgent?.model).toBe('fast');
  });

  it('routes to a loaded custom agent by explicit type', async () => {
    const project = await createTempAgentProject();
    root = project.root;

    const customAgents = await scanAgentDirs(root, { dirs: [project.agentDir], configDir: path.join(os.homedir(), '.thething') });
    customAgents.forEach(agent => registry.register(agent));

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
        agentRegistry: registry,
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
        agentRegistry: registry,
      },
    );

    expect(route.definition.agentType).toBe('explore');
    expect(route.reason).toContain('explore');
  });
});
