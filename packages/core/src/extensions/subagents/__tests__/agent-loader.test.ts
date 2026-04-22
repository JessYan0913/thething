import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { scanAgentDirs, registerBuiltinAgents, globalAgentRegistry } from '../index';
import { resolveAgentRoute } from '../router';

describe('Agent Loader Integration', () => {
  beforeAll(async () => {
    // 注册内置 Agent
    registerBuiltinAgents();

    // 加载自定义 Agent - 使用 packages/core 目录（测试数据在此）
    const cwd = path.resolve(process.cwd());
    const customAgents = await scanAgentDirs(cwd);
    for (const agent of customAgents) {
      globalAgentRegistry.register(agent);
    }
  });

  it('should have builtin agents registered', () => {
    const allAgents = globalAgentRegistry.getAll();
    const builtinAgents = allAgents.filter(a => a.source === 'builtin');

    expect(builtinAgents.length).toBeGreaterThan(0);
    expect(builtinAgents.some(a => a.agentType === 'explore')).toBe(true);
    expect(builtinAgents.some(a => a.agentType === 'research')).toBe(true);
  });

  it('should load custom agents from .thething/agents/', async () => {
    const allAgents = globalAgentRegistry.getAll();
    const customAgents = allAgents.filter(a => a.source === 'project' || a.source === 'user');

    // 应该找到 test-agent
    const testAgent = customAgents.find(a => a.agentType === 'test-agent');
    expect(testAgent).toBeDefined();

    if (testAgent) {
      expect(testAgent.description).toContain('测试 Agent');
      expect(testAgent.tools).toContain('read_file');
      expect(testAgent.tools).toContain('grep');
      expect(testAgent.model).toBe('fast');
      expect(testAgent.maxTurns).toBe(5);
    }
  });

  it('should route to correct agent by type', () => {
    const route = resolveAgentRoute(
      { agentType: 'test-agent', task: '验证加载' },
      { parentTools: {}, parentModel: {} as any, parentSystemPrompt: '', parentMessages: [], writerRef: { current: null }, abortSignal: new AbortController().signal, toolCallId: 'test', recursionDepth: 0 }
    );

    expect(route.type).toBe('named');
    expect(route.definition.agentType).toBe('test-agent');
  });

  it('should route to builtin explore agent', () => {
    const route = resolveAgentRoute(
      { agentType: 'explore', task: '查找文件' },
      { parentTools: {}, parentModel: {} as any, parentSystemPrompt: '', parentMessages: [], writerRef: { current: null }, abortSignal: new AbortController().signal, toolCallId: 'test', recursionDepth: 0 }
    );

    expect(route.type).toBe('named');
    expect(route.definition.agentType).toBe('explore');
  });

  it('should auto-route based on task keywords', () => {
    // 测试自动路由到 explore
    const exploreRoute = resolveAgentRoute(
      { task: 'find the main entry file' },
      { parentTools: {}, parentModel: {} as any, parentSystemPrompt: '', parentMessages: [], writerRef: { current: null }, abortSignal: new AbortController().signal, toolCallId: 'test', recursionDepth: 0 }
    );

    expect(exploreRoute.definition.agentType).toBe('explore');
    expect(exploreRoute.reason).toContain('explore');
  });
});