import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAgentRoute } from '../router';
import { AgentRegistry } from '../registry';
import { registerBuiltinAgents } from '../built-in';
import type { AgentExecutionContext } from '../types';

describe('subagents/router', () => {
  let registry: AgentRegistry;

  // Create minimal execution context
  const createMockContext = (): AgentExecutionContext => ({
    parentTools: {},
    parentModel: {} as any,
    parentSystemPrompt: '',
    parentMessages: [],
    writerRef: { current: null },
    abortSignal: new AbortController().signal,
    toolCallId: 'test-tool-call',
    agentRegistry: registry,
  });

  beforeEach(() => {
    registry = new AgentRegistry();
    registerBuiltinAgents(registry);
  });

  describe('resolveAgentRoute', () => {
    describe('explicit agentType', () => {
      it('should route to named agent when agentType is specified', () => {
        const result = resolveAgentRoute(
          { agentType: 'explore', task: 'test' },
          createMockContext()
        );

        expect(result.type).toBe('named');
        expect(result.definition.agentType).toBe('explore');
        expect(result.reason).toContain('Explicitly');
      });

      it('should route to general-purpose when agentType is "general"', () => {
        const result = resolveAgentRoute(
          { agentType: 'general', task: 'test' },
          createMockContext()
        );

        expect(result.type).toBe('general');
        expect(result.definition.agentType).toBe('general-purpose');
      });

      it('should fallback to general for unknown agentType', () => {
        const result = resolveAgentRoute(
          { agentType: 'unknown-type', task: 'test' },
          createMockContext()
        );

        expect(result.type).toBe('general');
        expect(result.definition.agentType).toBe('general-purpose');
        expect(result.reason).toContain('Unknown');
      });
    });

    describe('untyped agentType (LLM 自主决策)', () => {
      it('should NOT auto-route by keywords — always falls back to general-purpose', () => {
        const cases = [
          'find the main entry file',
          'locate the config file',
          'search for the API endpoint',
          'investigate the authentication flow',
          'analyze the performance bottleneck',
          'plan the new feature implementation',
          'design the database schema',
          '查找主入口文件',
          '调研认证流程的现状',
          '规划新功能的实现步骤',
          'do something random',
        ];
        for (const task of cases) {
          const result = resolveAgentRoute({ task }, createMockContext());
          expect(result.type).toBe('general');
          expect(result.definition.agentType).toBe('general-purpose');
          expect(result.reason).toContain('Default');
        }
      });

      it('should NOT route to plan for "continue"/"follow up" or large parent message count', () => {
        const eachCase: Array<[string, AgentExecutionContext]> = [
          ['continue with the previous work', createMockContext()],
          ['follow up on the investigation', createMockContext()],
          [
            'do something',
            {
              ...createMockContext(),
              parentMessages: Array(10).fill({ role: 'user', parts: [] }),
            },
          ],
        ];
        for (const [task, context] of eachCase) {
          const result = resolveAgentRoute({ task }, context);
          expect(result.type).toBe('general');
          expect(result.definition.agentType).toBe('general-purpose');
        }
      });
    });
  });

  describe('general-purpose fallback agent', () => {
    it('should have correct properties', () => {
      const result = resolveAgentRoute(
        { task: 'generic task' },
        createMockContext()
      );

      const def = result.definition;
      expect(def.agentType).toBe('general-purpose');
      expect(def.tools).toBeDefined();
      expect(def.model).toBe('inherit');
    });

    it('should have instructions', () => {
      const result = resolveAgentRoute(
        { task: 'generic task' },
        createMockContext()
      );

      expect(result.definition.instructions).toBeDefined();
      expect(result.definition.instructions).toContain('General-purpose agent');
    });
  });
});