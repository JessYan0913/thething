import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAgentRoute } from '../router';
import { globalAgentRegistry } from '../registry';
import { registerBuiltinAgents } from '../built-in';
import type { AgentExecutionContext } from '../types';

describe('subagents/router', () => {
  // Create minimal execution context
  const createMockContext = (): AgentExecutionContext => ({
    parentTools: {},
    parentModel: {} as any,
    parentSystemPrompt: '',
    parentMessages: [],
    writerRef: { current: null },
    abortSignal: new AbortController().signal,
    toolCallId: 'test-tool-call',
    recursionDepth: 0,
  });

  beforeEach(() => {
    // Register builtin agents before each test
    registerBuiltinAgents();
  });

  describe('resolveAgentRoute', () => {
    describe('recursion guard', () => {
      it('should block when recursion depth exceeds limit', () => {
        const context = {
          ...createMockContext(),
          recursionDepth: 10, // Exceeds limit (usually 5)
        };
        const result = resolveAgentRoute({ task: 'test task' }, context);

        expect(result.type).toBe('blocked');
        expect(result.definition.agentType).toBe('blocked');
        expect(result.reason).toContain('Recursion');
      });

      it('should allow when recursion depth is within limit', () => {
        const context = {
          ...createMockContext(),
          recursionDepth: 2,
        };
        const result = resolveAgentRoute({ task: 'test task' }, context);

        expect(result.type).not.toBe('blocked');
      });
    });

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

    describe('auto-routing based on task keywords', () => {
      it('should auto-route to explore for "find" keyword', () => {
        const result = resolveAgentRoute(
          { task: 'find the main entry file' },
          createMockContext()
        );

        expect(result.type).toBe('named');
        expect(result.definition.agentType).toBe('explore');
        expect(result.reason).toContain('explore');
      });

      it('should auto-route to explore for "locate" keyword', () => {
        const result = resolveAgentRoute(
          { task: 'locate the config file' },
          createMockContext()
        );

        expect(result.definition.agentType).toBe('explore');
      });

      it('should auto-route to explore for "search" keyword', () => {
        const result = resolveAgentRoute(
          { task: 'search for the API endpoint' },
          createMockContext()
        );

        expect(result.definition.agentType).toBe('explore');
      });

      it('should auto-route to research for "investigate" keyword', () => {
        const result = resolveAgentRoute(
          { task: 'investigate the authentication flow' },
          createMockContext()
        );

        expect(result.type).toBe('named');
        expect(result.definition.agentType).toBe('research');
        expect(result.reason).toContain('research');
      });

      it('should auto-route to research for "analyze" keyword', () => {
        const result = resolveAgentRoute(
          { task: 'analyze the performance bottleneck' },
          createMockContext()
        );

        expect(result.definition.agentType).toBe('research');
      });

      it('should auto-route to plan for "plan" keyword', () => {
        const result = resolveAgentRoute(
          { task: 'plan the new feature implementation' },
          createMockContext()
        );

        expect(result.type).toBe('named');
        expect(result.definition.agentType).toBe('plan');
        expect(result.reason).toContain('plan');
      });

      it('should auto-route to plan for "design" keyword', () => {
        const result = resolveAgentRoute(
          { task: 'design the database schema' },
          createMockContext()
        );

        expect(result.definition.agentType).toBe('plan');
      });

      it('should auto-route to plan for "architecture" keyword', () => {
        const result = resolveAgentRoute(
          { task: 'architecture for the new module' },
          createMockContext()
        );

        expect(result.definition.agentType).toBe('plan');
      });

      it('should fallback to general-purpose for generic task', () => {
        const result = resolveAgentRoute(
          { task: 'do something random' },
          createMockContext()
        );

        expect(result.type).toBe('general');
        expect(result.definition.agentType).toBe('general-purpose');
        expect(result.reason).toContain('Default');
      });

      it('should match keywords case-insensitively', () => {
        const result = resolveAgentRoute(
          { task: 'FIND the config file' },
          createMockContext()
        );

        expect(result.definition.agentType).toBe('explore');
      });
    });

    describe('parent context detection', () => {
      it('should route to plan when task mentions "continue"', () => {
        const result = resolveAgentRoute(
          { task: 'continue with the previous work' },
          createMockContext()
        );

        expect(result.definition.agentType).toBe('plan');
        expect(result.reason).toContain('parent context');
      });

      it('should route to plan when task mentions "follow up"', () => {
        const result = resolveAgentRoute(
          { task: 'follow up on the investigation' },
          createMockContext()
        );

        expect(result.definition.agentType).toBe('plan');
      });

      it('should route to plan when messages exceed threshold', () => {
        const context = {
          ...createMockContext(),
          parentMessages: Array(10).fill({ role: 'user', parts: [] }),
        };
        const result = resolveAgentRoute(
          { task: 'do something' },
          context
        );

        // Should route to plan because of message count
        expect(result.definition.agentType).toBe('plan');
        expect(result.reason).toContain('parent context');
      });

      it('should not route to plan for small message count', () => {
        const context = {
          ...createMockContext(),
          parentMessages: [{ id: 'msg-1', role: 'user' as const, parts: [] }],
        };
        const result = resolveAgentRoute(
          { task: 'do something random' },
          context
        );

        // Should fallback to general since no keywords match and small messages
        expect(result.type).toBe('general');
      });
    });
  });

  describe('task classification functions', () => {
    it('should classify "where is" as explore task', () => {
      const result = resolveAgentRoute(
        { task: 'where is the main function?' },
        createMockContext()
      );

      expect(result.definition.agentType).toBe('explore');
    });

    it('should classify "how do i find" as explore task', () => {
      const result = resolveAgentRoute(
        { task: 'how do i find the error source?' },
        createMockContext()
      );

      expect(result.definition.agentType).toBe('explore');
    });

    it('should classify "deep dive" as research task', () => {
      const result = resolveAgentRoute(
        { task: 'deep dive into the caching mechanism' },
        createMockContext()
      );

      expect(result.definition.agentType).toBe('research');
    });

    it('should classify "study" as research task', () => {
      const result = resolveAgentRoute(
        { task: 'study the error patterns' },
        createMockContext()
      );

      expect(result.definition.agentType).toBe('research');
    });

    it('should classify "how should i" as plan task', () => {
      const result = resolveAgentRoute(
        { task: 'how should i structure the API?' },
        createMockContext()
      );

      expect(result.definition.agentType).toBe('plan');
    });

    it('should classify "implement" as plan task', () => {
      const result = resolveAgentRoute(
        { task: 'implement the login feature' },
        createMockContext()
      );

      expect(result.definition.agentType).toBe('plan');
    });

    it('should classify "strategy" as plan task', () => {
      const result = resolveAgentRoute(
        { task: 'strategy for handling errors' },
        createMockContext()
      );

      expect(result.definition.agentType).toBe('plan');
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
      expect(def.tools).toContain('*');
      expect(def.model).toBe('inherit');
      expect(def.maxTurns).toBe(20);
      expect(def.summarizeOutput).toBe(true);
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