import type { LanguageModel, StopCondition, ToolSet, UIMessage } from 'ai';
import { stepCountIs, tool, ToolLoopAgent } from 'ai';
import { z } from 'zod';
import {
  buildSubAgentPrompt,
  createSubAgentContext,
  extractContextForSubAgent,
  finalizeSubAgentContext,
} from './context';
import { getGlobalTaskStore, completeTask, failTask, updateTaskStatus } from '../tasks';

function fireAndForget<T>(fn: () => T): void {
  setTimeout(fn, 0);
}

export type SubAgentTools = ToolSet;

export type SubAgentStreamWriter = {
  write: (chunk: Record<string, unknown>) => void;
};

export interface AgentToolConfig {
  name: string;
  description?: string;
  instructions: string;
  model: LanguageModel;
  tools: SubAgentTools;
  maxSteps?: number;
  parentContext?: {
    messages: UIMessage[];
    includeToolCalls?: boolean;
    maxContextMessages?: number;
  };
  abortSignal?: AbortSignal;
  writerRef?: { current: SubAgentStreamWriter | null };
}

export interface AgentToolResult {
  success: boolean;
  summary: string;
  durationMs: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  error?: string;
}

const AgentInputSchema = z.object({
  task: z.string().describe('The sub-task to delegate to the sub-agent'),
  taskId: z.string().optional().describe('Optional task ID to update when sub-agent completes'),
});

type AgentInput = z.infer<typeof AgentInputSchema>;

export function createAgentTool(config: AgentToolConfig) {
  const toolName = config.name;
  const toolDescription =
    config.description ?? config.instructions.slice(0, 200) + (config.instructions.length > 200 ? '...' : '');

  const maxSteps = config.maxSteps ?? 20;
  const stopWhen = stepCountIs(maxSteps) as StopCondition<SubAgentTools>;

  type ExecuteReturn = AgentToolResult;

  return tool<AgentInput, ExecuteReturn>({
    description: toolDescription,
    inputSchema: AgentInputSchema,
    execute: async ({ task, taskId }: AgentInput, options: { abortSignal?: AbortSignal; toolCallId?: string }) => {
      const startTime = Date.now();
      const toolCallId = options.toolCallId ?? `sub-${Date.now()}`;
      const writer = config.writerRef?.current ?? null;

      const context = createSubAgentContext('parent', toolName, config.parentContext?.messages ?? []);

      const parentContext = config.parentContext?.messages
        ? extractContextForSubAgent(config.parentContext.messages, {
            maxMessages: config.parentContext.maxContextMessages,
            includeToolCalls: config.parentContext.includeToolCalls,
          })
        : undefined;

      const subAgentPrompt = buildSubAgentPrompt({
        instructions: config.instructions,
        task,
        parentContext,
      });

      const effectiveAbortSignal = options.abortSignal ?? config.abortSignal;

      writer?.write({
        type: 'data-sub-open',
        id: toolCallId,
        data: { agentName: toolName, task },
      });

      if (taskId) {
        try {
          const store = getGlobalTaskStore();
          updateTaskStatus(store, taskId, 'in_progress');
        } catch (err) {
          console.error('[SubAgent] Failed to update task status:', err);
        }
      }

      try {
        const subAgent = new ToolLoopAgent({
          model: config.model,
          instructions: subAgentPrompt,
          tools: config.tools,
          stopWhen,
        });

        const streamResult = await subAgent.stream({
          prompt: task,
          abortSignal: effectiveAbortSignal,
        });

        let textContent = '';
        const childMessages: UIMessage[] = [];

        for await (const part of streamResult.fullStream) {
          if (part.type === 'text-delta') {
            textContent += part.text;
            writer?.write({
              type: 'data-sub-text-delta',
              id: toolCallId,
              data: { text: part.text, accumulated: textContent },
            });
          }
          if (part.type === 'tool-call') {
            console.log(`[SubAgent:${toolName}] Invoking: ${part.toolName}`);
            writer?.write({
              type: 'data-sub-tool-call',
              id: toolCallId,
              data: { name: part.toolName, input: part.input },
            });
          }
          if (part.type === 'tool-result') {
            const output = typeof part.output === 'string' ? part.output : JSON.stringify(part.output).slice(0, 200);
            console.log(`[SubAgent:${toolName}] Result: ${output}`);
            writer?.write({
              type: 'data-sub-tool-result',
              id: toolCallId,
              data: { name: part.toolName, result: output },
            });
          }
          if (part.type === 'tool-call' || part.type === 'tool-result') {
            childMessages.push(part as unknown as UIMessage);
          }
        }

        const duration = Date.now() - startTime;
        const usage = await streamResult.usage;
        const finalText = textContent;

        finalizeSubAgentContext(context, childMessages, 'completed');

        console.log(`[SubAgent:${toolName}] Completed in ${duration}ms, ${usage?.totalTokens ?? 0} tokens`);

        if (taskId) {
          try {
            const store = getGlobalTaskStore();
            fireAndForget(() => {
              completeTask(store, taskId, finalText);
            });
          } catch (err) {
            console.error('[SubAgent] Failed to update task:', err);
          }
        }

        writer?.write({
          type: 'data-sub-done',
          id: toolCallId,
          data: {
            success: true,
            durationMs: duration,
            inputTokens: Number(usage?.inputTokens ?? 0),
            outputTokens: Number(usage?.outputTokens ?? 0),
            totalTokens: Number(usage?.totalTokens ?? 0),
          },
        });

        return {
          success: true,
          summary: finalText,
          durationMs: duration,
          tokenUsage: usage
            ? {
                inputTokens: Number(usage.inputTokens ?? 0),
                outputTokens: Number(usage.outputTokens ?? 0),
                totalTokens: Number(usage.totalTokens ?? 0),
              }
            : undefined,
        } satisfies AgentToolResult;
      } catch (error) {
        const isAborted = error instanceof Error && error.name === 'AbortError';
        const status = isAborted ? 'aborted' : 'failed';
        const errorMsg = error instanceof Error ? error.message : String(error);

        const duration = Date.now() - startTime;
        finalizeSubAgentContext(context, [], status, errorMsg);

        console.error(`[SubAgent:${toolName}] ${status}: ${errorMsg}`);

        if (taskId) {
          try {
            const store = getGlobalTaskStore();
            fireAndForget(() => {
              failTask(store, taskId, errorMsg);
            });
          } catch (err) {
            console.error('[SubAgent] Failed to update task:', err);
          }
        }

        writer?.write({
          type: 'data-sub-done',
          id: toolCallId,
          data: { success: false, durationMs: duration, error: errorMsg },
        });

        return {
          success: false,
          summary: `Sub-agent ${status}: ${errorMsg}`,
          durationMs: duration,
          error: errorMsg,
        } satisfies AgentToolResult;
      }
    },
    toModelOutput: ({ output }: { output: AgentToolResult }): { type: 'text'; value: string } => {
      return { type: 'text', value: output.summary };
    },
  });
}