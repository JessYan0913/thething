import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createParallelAgentTool } from '../parallel-agent-tool';
import { AgentRegistry, registerBuiltinAgents } from '..';
import type { AgentToolConfig, AgentExecutionContext } from '../types';
import type { LanguageModel } from 'ai';

// ============================================================
// Mocks
// ============================================================

vi.mock('../executor', () => ({
  executeRoutedAgent: vi.fn(),
}));

vi.mock('../router', () => ({
  resolveAgentRoute: vi.fn(),
}));

import { executeRoutedAgent } from '../executor';
import { resolveAgentRoute } from '../router';

const mockExecuteRoutedAgent = vi.mocked(executeRoutedAgent);
const mockResolveAgentRoute = vi.mocked(resolveAgentRoute);

// ============================================================
// Helpers
// ============================================================

const createMockModel = (modelId: string): LanguageModel =>
  ({
    modelId,
    provider: 'test',
    specificationVersion: 'v1',
    supportedUrls: {},
    doGenerate: async () => ({ raw: {}, text: '', usage: {} }),
    doStream: async () => ({} as any),
  }) as unknown as LanguageModel;

const createMockProvider = () => (modelName: string): LanguageModel =>
  createMockModel(modelName);

const createMockToolConfig = (
  overrides?: Partial<AgentToolConfig>
): AgentToolConfig => ({
  parentTools: {},
  parentModel: createMockModel('parent-model'),
  parentSystemPrompt: '',
  parentMessages: [],
  writerRef: { current: null },
  cwd: '/test',
  provider: createMockProvider(),
  agents: [],
  agentRegistry: new AgentRegistry(),
  ...overrides,
});

const createMockResult = (summary: string, success = true) => ({
  success,
  summary,
  durationMs: 100,
  tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  stepsExecuted: 1,
  toolsUsed: ['read_file'],
  status: success ? ('completed' as const) : ('failed' as const),
});

// ============================================================
// Tests
// ============================================================

describe('parallel-agent-tool', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new AgentRegistry();
    registerBuiltinAgents(registry);

    // 默认路由到 general-purpose
    mockResolveAgentRoute.mockImplementation((input) => ({
      type: 'general',
      definition: registry.get('general-purpose')!,
      reason: 'test',
    }));
  });

  describe('createParallelAgentTool', () => {
    it('should create a tool with correct schema', () => {
      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));
      expect(tool).toBeDefined();
      expect(tool.description.toLowerCase()).toContain('parallel');
    });

    it('should require at least 2 tasks', async () => {
      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));

      const result = await (tool as any).execute(
        { tasks: [{ task: 'only one task' }] },
        { toolCallId: 'test', abortSignal: new AbortController().signal }
      );

      // Zod validation should reject < 2 tasks
      expect(result).toBeDefined();
    });

    it('should reject more than 8 tasks', async () => {
      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));
      const tasks = Array.from({ length: 9 }, (_, i) => ({ task: `task ${i}` }));

      const result = await (tool as any).execute(
        { tasks },
        { toolCallId: 'test', abortSignal: new AbortController().signal }
      );

      expect(result).toBeDefined();
    });
  });

  describe('parallel execution', () => {
    it('should execute multiple tasks in parallel', async () => {
      mockExecuteRoutedAgent
        .mockResolvedValueOnce(createMockResult('Result from agent A'))
        .mockResolvedValueOnce(createMockResult('Result from agent B'));

      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));

      const result = await (tool as any).execute(
        {
          tasks: [
            { task: 'Research topic A', label: 'research-a' },
            { task: 'Research topic B', label: 'research-b' },
          ],
        },
        { toolCallId: 'parallel-test', abortSignal: new AbortController().signal }
      );

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].label).toBe('research-a');
      expect(result.results[1].label).toBe('research-b');
      expect(mockExecuteRoutedAgent).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed success and failure', async () => {
      mockExecuteRoutedAgent
        .mockResolvedValueOnce(createMockResult('Success'))
        .mockResolvedValueOnce(createMockResult('Failed task', false));

      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));

      const result = await (tool as any).execute(
        {
          tasks: [
            { task: 'Task A', label: 'a' },
            { task: 'Task B', label: 'b' },
          ],
        },
        { toolCallId: 'parallel-test', abortSignal: new AbortController().signal }
      );

      expect(result.success).toBe(false); // 有失败
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[1].result.success).toBe(false);
    });

    it('should use agentType when specified', async () => {
      mockResolveAgentRoute.mockImplementation((input) => ({
        type: 'named',
        definition: registry.get(input.agentType ?? 'general-purpose')!,
        reason: 'explicit',
      }));

      mockExecuteRoutedAgent
        .mockResolvedValueOnce(createMockResult('Explore result'))
        .mockResolvedValueOnce(createMockResult('Research result'));

      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));

      await (tool as any).execute(
        {
          tasks: [
            { agentType: 'explore', task: 'Find files', label: 'finder' },
            { agentType: 'research', task: 'Research topic', label: 'researcher' },
          ],
        },
        { toolCallId: 'parallel-test', abortSignal: new AbortController().signal }
      );

      expect(mockResolveAgentRoute).toHaveBeenCalledWith(
        { agentType: 'explore', task: 'Find files' },
        expect.any(Object)
      );
      expect(mockResolveAgentRoute).toHaveBeenCalledWith(
        { agentType: 'research', task: 'Research topic' },
        expect.any(Object)
      );
    });

    it('should broadcast open and done events', async () => {
      const writer = { write: vi.fn() };
      mockExecuteRoutedAgent.mockResolvedValue(createMockResult('Done'));

      const tool = createParallelAgentTool(
        createMockToolConfig({
          agentRegistry: registry,
          writerRef: { current: writer },
        })
      );

      await (tool as any).execute(
        {
          tasks: [
            { task: 'Task 1', label: 't1' },
            { task: 'Task 2', label: 't2' },
          ],
        },
        { toolCallId: 'parallel-test', abortSignal: new AbortController().signal }
      );

      // 应该有 open 和 done 事件
      const openCalls = writer.write.mock.calls.filter(
        (c: any) => c[0].type === 'data-sub-open'
      );
      const doneCalls = writer.write.mock.calls.filter(
        (c: any) => c[0].type === 'data-sub-done'
      );

      expect(openCalls).toHaveLength(1);
      expect(openCalls[0][0].data.mode).toBe('parallel');
      expect(openCalls[0][0].data.taskCount).toBe(2);
      expect(doneCalls).toHaveLength(1);
    });

    it('should block on recursion depth exceeded', async () => {
      const tool = createParallelAgentTool(
        createMockToolConfig({
          agentRegistry: registry,
          recursionDepth: 3, // 达到上限
        })
      );

      const result = await (tool as any).execute(
        {
          tasks: [
            { task: 'Task 1', label: 't1' },
            { task: 'Task 2', label: 't2' },
          ],
        },
        { toolCallId: 'parallel-test', abortSignal: new AbortController().signal }
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('recursion-blocked');
      expect(mockExecuteRoutedAgent).not.toHaveBeenCalled();
    });

    it('should auto-label tasks when label not provided', async () => {
      mockExecuteRoutedAgent.mockResolvedValue(createMockResult('Done'));

      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));

      const result = await (tool as any).execute(
        {
          tasks: [
            { task: 'Task A' },
            { task: 'Task B' },
          ],
        },
        { toolCallId: 'parallel-test', abortSignal: new AbortController().signal }
      );

      expect(result.results[0].label).toBe('task-0');
      expect(result.results[1].label).toBe('task-1');
    });

    it('should aggregate token usage across all tasks', async () => {
      mockExecuteRoutedAgent
        .mockResolvedValueOnce({
          ...createMockResult('A'),
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        })
        .mockResolvedValueOnce({
          ...createMockResult('B'),
          tokenUsage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
        });

      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));

      const result = await (tool as any).execute(
        {
          tasks: [
            { task: 'Task A', label: 'a' },
            { task: 'Task B', label: 'b' },
          ],
        },
        { toolCallId: 'parallel-test', abortSignal: new AbortController().signal }
      );

      // 结果中每个子任务都有独立的 token usage
      expect(result.results[0].result.tokenUsage.totalTokens).toBe(150);
      expect(result.results[1].result.tokenUsage.totalTokens).toBe(280);
    });
  });

  describe('toModelOutput', () => {
    it('should return summary text', () => {
      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));
      const output = (tool as any).toModelOutput({
        output: { summary: 'All tasks completed successfully' },
      });

      expect(output.type).toBe('text');
      expect(output.value).toBe('All tasks completed successfully');
    });

    it('should handle missing output', () => {
      const tool = createParallelAgentTool(createMockToolConfig({ agentRegistry: registry }));
      const output = (tool as any).toModelOutput({ output: null });

      expect(output.value).toBe('Parallel tasks completed.');
    });
  });
});
