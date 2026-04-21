import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentDefinition, AgentExecutionResult, TokenUsageStats, AgentToolInput } from '../core/types';
import { globalAgentRegistry } from '../core/registry';

// ============================================================
// Subagents Module Tests
// ============================================================
describe('subagents', () => {
  describe('types', () => {
    describe('AgentDefinition', () => {
      it('should have required fields', () => {
        const agent: AgentDefinition = {
          agentType: 'test-agent',
          instructions: 'Test agent instructions',
        };
        expect(agent.agentType).toBeDefined();
        expect(agent.instructions).toBeDefined();
      });

      it('should have optional fields', () => {
        const agent: AgentDefinition = {
          agentType: 'full-agent',
          displayName: 'Full Agent',
          description: 'A complete agent definition',
          allowedTools: ['bash', 'read'],
          disallowedTools: ['write'],
          model: 'inherit',
          includeParentContext: true,
          maxParentMessages: 10,
          maxSteps: 5,
          instructions: 'Full instructions',
          summarizeOutput: true,
        };
        expect(agent.displayName).toBeDefined();
        expect(agent.allowedTools).toBeDefined();
        expect(agent.maxSteps).toBeDefined();
      });

      it('should accept valid model types', () => {
        const models = ['inherit', 'fast', 'smart'] as const;
        models.forEach((model) => {
          const agent: AgentDefinition = {
            agentType: 'agent-' + model,
            model: model,
            instructions: 'Test',
          };
          expect(agent.model).toBe(model);
        });
      });
    });

    describe('AgentExecutionResult', () => {
      it('should have required fields', () => {
        const result: AgentExecutionResult = {
          success: true,
          summary: 'Task completed',
          durationMs: 1000,
          stepsExecuted: 5,
          toolsUsed: ['bash', 'read'],
          status: 'completed',
        };
        expect(result.success).toBeDefined();
        expect(result.summary).toBeDefined();
        expect(result.durationMs).toBeDefined();
        expect(result.stepsExecuted).toBeDefined();
        expect(result.toolsUsed).toBeDefined();
        expect(result.status).toBeDefined();
      });

      it('should have valid status values', () => {
        const statuses = ['completed', 'failed', 'aborted', 'recursion-blocked'] as const;
        statuses.forEach((status) => {
          const result: AgentExecutionResult = {
            success: status === 'completed',
            summary: 'Test',
            durationMs: 100,
            stepsExecuted: 0,
            toolsUsed: [],
            status: status,
          };
          expect(result.status).toBe(status);
        });
      });

      it('should have optional token usage', () => {
        const tokenUsage: TokenUsageStats = {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
        };
        const result: AgentExecutionResult = {
          success: true,
          summary: 'Done',
          durationMs: 100,
          stepsExecuted: 1,
          toolsUsed: [],
          status: 'completed',
          tokenUsage: tokenUsage,
        };
        expect(result.tokenUsage?.totalTokens).toBe(1500);
      });
    });

    describe('AgentToolInput', () => {
      it('should have task field', () => {
        const input: AgentToolInput = {
          task: 'Complete the task',
        };
        expect(input.task).toBeDefined();
      });

      it('should have optional agentType', () => {
        const input: AgentToolInput = {
          agentType: 'research',
          task: 'Research topic',
        };
        expect(input.agentType).toBeDefined();
      });
    });
  });

  describe('registry', () => {
    // Clear registry before each test
    beforeEach(() => {
      // Get all agents and unregister them
      const allAgents = globalAgentRegistry.getAll();
      allAgents.forEach((agent) => {
        globalAgentRegistry.unregister(agent.agentType);
      });
    });

    describe('globalAgentRegistry', () => {
      it('should register agent', () => {
        const agent: AgentDefinition = {
          agentType: 'test-agent',
          instructions: 'Test instructions',
        };
        globalAgentRegistry.register(agent);
        expect(globalAgentRegistry.has('test-agent')).toBe(true);
      });

      it('should get agent by type', () => {
        const agent: AgentDefinition = {
          agentType: 'get-test',
          instructions: 'Test',
        };
        globalAgentRegistry.register(agent);
        const retrieved = globalAgentRegistry.get('get-test');
        expect(retrieved?.agentType).toBe('get-test');
      });

      it('should return undefined for non-existent agent', () => {
        expect(globalAgentRegistry.get('non-existent')).toBeUndefined();
      });

      it('should get all agents', () => {
        globalAgentRegistry.register({ agentType: 'agent1', instructions: '1' });
        globalAgentRegistry.register({ agentType: 'agent2', instructions: '2' });
        const all = globalAgentRegistry.getAll();
        expect(all.length).toBe(2);
      });

      it('should check if agent exists', () => {
        globalAgentRegistry.register({ agentType: 'exists-test', instructions: 'Test' });
        expect(globalAgentRegistry.has('exists-test')).toBe(true);
        expect(globalAgentRegistry.has('no-exists')).toBe(false);
      });

      it('should unregister agent', () => {
        globalAgentRegistry.register({ agentType: 'unregister-test', instructions: 'Test' });
        expect(globalAgentRegistry.has('unregister-test')).toBe(true);
        globalAgentRegistry.unregister('unregister-test');
        expect(globalAgentRegistry.has('unregister-test')).toBe(false);
      });

      it('should return false when unregistering non-existent', () => {
        expect(globalAgentRegistry.unregister('non-existent')).toBe(false);
      });

      it('should overwrite existing agent', () => {
        globalAgentRegistry.register({ agentType: 'overwrite', instructions: 'Original' });
        globalAgentRegistry.register({ agentType: 'overwrite', instructions: 'Updated' });
        const agent = globalAgentRegistry.get('overwrite');
        expect(agent?.instructions).toBe('Updated');
      });
    });
  });
});