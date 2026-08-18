// ============================================================
// Agent Tool - 白名单 description + 执行前工具匹配校验 测试
// ============================================================
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentTool, executeAgentTask } from '../agent-tool';
import { AgentRegistry } from '..';
import type { AgentToolConfig } from '../types';
import type { LanguageModel } from 'ai';

// executeRoutedAgent 在命中校验后才被调用；未命中（降级）时不应调用
vi.mock('../executor', () => ({
  executeRoutedAgent: vi.fn().mockResolvedValue({
    success: true,
    summary: 'mocked sub-agent done',
    durationMs: 10,
    stepsExecuted: 1,
    toolsUsed: [],
    status: 'completed',
  }),
}));

import { executeRoutedAgent } from '../executor';
const mockExecuteRoutedAgent = vi.mocked(executeRoutedAgent);

const createMockModel = (modelId: string): LanguageModel =>
  ({
    modelId,
    provider: 'test',
    specificationVersion: 'v1',
    supportedUrls: {},
    doGenerate: async () => ({ raw: {}, text: '', usage: {} }),
    doStream: async () => ({} as any),
  }) as unknown as LanguageModel;

const createMockToolConfig = (overrides?: Partial<AgentToolConfig>): AgentToolConfig => ({
  parentTools: {},
  parentModel: createMockModel('parent-model'),
  parentSystemPrompt: '',
  parentMessages: [],
  writerRef: { current: null },
  cwd: '/test',
  provider: (m: string) => createMockModel(m),
  agents: [],
  agentRegistry: new AgentRegistry(),
  configDir: path.join(os.homedir(), '.thething'),
  ...overrides,
});

function agent(agentType: string, tools: string[], metadata?: Record<string, unknown>) {
  return { agentType, tools, instructions: 'test', source: 'user' as const, metadata };
}

describe('createAgentTool description 白名单', () => {
  it('只列出 metadata.isSubAgentAvailable=true 的 Agent，隐藏其他', () => {
    const registry = new AgentRegistry();
    registry.register(agent('delegatable', ['write_file'], { isSubAgentAvailable: true }));
    registry.register(agent('private', ['read_file'], { isSubAgentAvailable: false }));
    registry.register(agent('no-metadata', ['read_file']));

    const tool = createAgentTool(createMockToolConfig({ agentRegistry: registry }));
    const desc = typeof tool.description === 'string' ? tool.description : '';
    expect(desc).toContain('delegatable');
    expect(desc).not.toContain('private');
    expect(desc).not.toContain('no-metadata');
  });

  it('agentList 含能力边界标注（自动推导：含 bash 才算可写，web_fetch 单列）', () => {
    const registry = new AgentRegistry();
    registry.register(agent('ro', ['read_file', 'grep', 'glob'], { isSubAgentAvailable: true }));
    registry.register(agent('web-ro', ['read_file', 'web_fetch'], { isSubAgentAvailable: true }));
    registry.register(agent('rw', ['read_file', 'bash'], { isSubAgentAvailable: true }));
    registry.register(agent('rw-web', ['read_file', 'write_file', 'web_fetch'], { isSubAgentAvailable: true }));

    const tool = createAgentTool(createMockToolConfig({ agentRegistry: registry }));
    const desc = typeof tool.description === 'string' ? tool.description : '';
    expect(desc).toContain('能力：只读');
    expect(desc).toContain('能力：只读 + web');
    expect(desc).toContain('能力：可写文件');
    expect(desc).toContain('能力：可写文件（全工具）');
  });
});

describe('executeAgentTask', () => {
  beforeEach(() => {
    mockExecuteRoutedAgent.mockClear();
  });

  it('子Agent 正常执行（调用 executeRoutedAgent）', async () => {
    const registry = new AgentRegistry();
    registry.register(agent('coder', ['write_file', 'read_file', 'bash']));

    const result = await executeAgentTask({
      agentType: 'coder',
      task: '实现并运行测试',
      config: createMockToolConfig({ agentRegistry: registry }),
      toolCallId: 'tc-2',
    });

    expect(result.success).toBe(true);
    expect(mockExecuteRoutedAgent).toHaveBeenCalledTimes(1);
  });

  it('子Agent 成功但无实质交付物（executor 兜底文案）→ 降级，不把空结果当成功（P0）', async () => {
    mockExecuteRoutedAgent.mockResolvedValueOnce({
      success: true,
      summary: 'Agent completed 3 tool calls using read_file, grep. No text summary was produced.',
      durationMs: 50,
      stepsExecuted: 3,
      toolsUsed: ['read_file', 'grep'],
      status: 'completed',
    });

    const registry = new AgentRegistry();
    registry.register(agent('analyst', ['read_file', 'grep', 'glob']));

    const result = await executeAgentTask({
      agentType: 'analyst',
      task: '分析模块A代码',
      config: createMockToolConfig({ agentRegistry: registry }),
      toolCallId: 'tc-nd',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no deliverable');
    expect(result.summary).toContain('未返回实质交付物');
  });
});
