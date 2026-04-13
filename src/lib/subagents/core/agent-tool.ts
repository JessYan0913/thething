import { tool } from 'ai';
import { z } from 'zod';
import { resolveAgentRoute } from './router';
import { executeRoutedAgent } from '../execution/executor';
import { checkRecursionGuard, RecursionTracker } from '../execution/recursion-guard';
import { globalAgentRegistry } from './registry';
import type { AgentToolConfig, AgentExecutionContext, AgentExecutionResult } from './types';
import { RESEARCH_AGENT } from '../agents/research-agent';
import { ANALYSIS_AGENT } from '../agents/analysis-agent';
import { WRITING_AGENT } from '../agents/writing-agent';
import { EXPLORE_AGENT } from '../agents/explore-agent';
import { CONTEXT_AGENT } from '../agents/context-agent';
import { GENERAL_AGENT } from '../agents/general-agent';
import { CODE_AGENT } from '../agents/code-agent';

const AgentToolInputSchema = z.object({
  agentType: z.string().optional().describe('Optional agent type: explore, research, code, plan, context, or general'),
  task: z.string().describe('The task for the sub-agent to complete'),
});

const tracker = new RecursionTracker();

export function createAgentTool(config: AgentToolConfig) {
  return tool({
    description: `Delegate a task to a specialized sub-agent.

Available agent types:
- explore: Read-only codebase exploration (fast model)
- research: Deep investigation with web search
- code: Code implementation with edit/write tools
- plan: Create implementation plans without executing
- context: Inherits parent context summary for complex tasks
- analysis: Analyze documents and extract insights
- writing: Create or edit content

If no agentType specified, will auto-route based on task characteristics.`,

    inputSchema: AgentToolInputSchema,

    execute: async ({ agentType, task }, options) => {
      const startTime = Date.now();
      const toolCallId = options.toolCallId ?? `agent-${Date.now()}`;
      const abortSignal = options.abortSignal;
      const writer = config.writerRef?.current ?? null;

      const depth = config.recursionDepth ?? 0;
      tracker.enter(toolCallId);

      try {
        if (checkRecursionGuard({ recursionDepth: depth })) {
          tracker.exit(toolCallId);
          return {
            success: false,
            summary: 'Agent execution blocked: maximum recursion depth exceeded',
            durationMs: Date.now() - startTime,
            stepsExecuted: 0,
            toolsUsed: [],
            status: 'recursion-blocked' as const,
          };
        }

        writer?.write({
          type: 'data-sub-open',
          id: toolCallId,
          data: { agentType: agentType ?? 'auto', task },
        });

        const context: AgentExecutionContext = {
          parentTools: config.parentTools,
          parentModel: config.parentModel,
          parentSystemPrompt: config.parentSystemPrompt,
          parentMessages: config.parentMessages,
          writerRef: config.writerRef,
          abortSignal: abortSignal ?? new AbortController().signal,
          toolCallId,
          recursionDepth: depth,
        };

        const routeDecision = resolveAgentRoute({ agentType, task }, context);

        console.log(
          `[AgentTool] Routing to ${routeDecision.type} (${routeDecision.definition.agentType})`,
          `| Reason: ${routeDecision.reason}`,
          `| Depth: ${depth}`
        );

        const result = await executeRoutedAgent(
          routeDecision.definition,
          context,
          task
        );

        tracker.exit(toolCallId);

        writer?.write({
          type: 'data-sub-done',
          id: toolCallId,
          data: {
            success: result.success,
            durationMs: result.durationMs,
            agentType: routeDecision.definition.agentType,
            stepsExecuted: result.stepsExecuted,
            toolsUsed: result.toolsUsed,
            tokenUsage: result.tokenUsage,
            status: result.status,
          },
        });

        return result;
      } catch (error) {
        tracker.exit(toolCallId);

        const isAborted = error instanceof Error && error.name === 'AbortError';
        const errorMsg = error instanceof Error ? error.message : String(error);

        writer?.write({
          type: 'data-sub-done',
          id: toolCallId,
          data: {
            success: false,
            durationMs: Date.now() - startTime,
            error: errorMsg,
            status: isAborted ? 'aborted' : 'failed',
          },
        });

        return {
          success: false,
          summary: `Agent ${isAborted ? 'aborted' : 'failed'}: ${errorMsg}`,
          durationMs: Date.now() - startTime,
          stepsExecuted: 0,
          toolsUsed: [],
          error: errorMsg,
          status: isAborted ? 'aborted' : 'failed',
        };
      }
    },

    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'summary' in output) {
        const result = output as AgentExecutionResult;
        return { type: 'text' as const, value: result.summary };
      }
      return { type: 'text' as const, value: 'Task completed.' };
    },
  });
}

export function initializeAgentRegistry() {
  globalAgentRegistry.register(RESEARCH_AGENT);
  globalAgentRegistry.register(ANALYSIS_AGENT);
  globalAgentRegistry.register(WRITING_AGENT);
  globalAgentRegistry.register(EXPLORE_AGENT);
  globalAgentRegistry.register(CONTEXT_AGENT);
  globalAgentRegistry.register(GENERAL_AGENT);
  globalAgentRegistry.register(CODE_AGENT);
}
