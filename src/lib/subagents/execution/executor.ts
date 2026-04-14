import { ToolLoopAgent, stepCountIs } from 'ai';
import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentExecutionResult,
} from '../core/types';
import { resolveToolsForAgent } from './tool-resolver';
import { resolveModelForAgent } from './model-resolver';
import { buildSubAgentPrompt, buildContextPrompt } from './context-builder';
import { completeTask, failTask, updateTaskStatus } from '@/lib/tasks';

function fireAndForget<T>(fn: () => T): void {
  setTimeout(fn, 0);
}

export async function executeRoutedAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
  task: string,
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const { toolCallId, writerRef, abortSignal, taskStore, taskId } = context;
  const writer = writerRef.current;

  try {
    const activeTools = resolveToolsForAgent(definition, context);
    const model = resolveModelForAgent(definition, context);
    const instructions = buildSubAgentPrompt(definition, context);
    const maxSteps = definition.maxSteps ?? 20;
    const stopWhen = definition.stopWhen ?? [stepCountIs(maxSteps)];

    const subAgent = new ToolLoopAgent({
      model,
      instructions,
      tools: context.parentTools,
      activeTools,
      stopWhen,
    });

    const streamResult = await subAgent.stream({
      prompt: definition.includeParentContext
        ? buildContextPrompt(context, task)
        : task,
      abortSignal,
    });

    if (taskStore && taskId) {
      updateTaskStatus(taskStore, taskId, 'in_progress');
    }

    let textContent = '';
    let stepsExecuted = 0;
    const toolsUsed: string[] = [];

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
        stepsExecuted++;
        toolsUsed.push(part.toolName);
        writer?.write({
          type: 'data-sub-tool-call',
          id: toolCallId,
          data: { name: part.toolName, input: part.input },
        });
      }
      if (part.type === 'tool-result') {
        const output =
          typeof part.output === 'string'
            ? part.output
            : JSON.stringify(part.output).slice(0, 200);
        writer?.write({
          type: 'data-sub-tool-result',
          id: toolCallId,
          data: { name: part.toolName, result: output },
        });
      }
    }

    const usage = await streamResult.usage;
    const duration = Date.now() - startTime;
    const tokenUsage = usage
      ? {
          inputTokens: Number(usage.inputTokens ?? 0),
          outputTokens: Number(usage.outputTokens ?? 0),
          totalTokens: Number(usage.totalTokens ?? 0),
        }
      : undefined;

    const result: AgentExecutionResult = {
      success: true,
      summary: textContent || 'Agent completed with no text output.',
      durationMs: duration,
      tokenUsage,
      stepsExecuted,
      toolsUsed: [...new Set(toolsUsed)],
      status: 'completed',
    };

    if (taskStore && taskId) {
      fireAndForget(() => {
        completeTask(taskStore, taskId, result.summary);
      });
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const isAborted = error instanceof Error && error.name === 'AbortError';
    const errorMsg = error instanceof Error ? error.message : String(error);

    const result: AgentExecutionResult = {
      success: false,
      summary: `Agent ${isAborted ? 'aborted' : 'failed'}: ${errorMsg}`,
      durationMs: duration,
      stepsExecuted: 0,
      toolsUsed: [],
      error: errorMsg,
      status: isAborted ? 'aborted' : 'failed',
    };

    if (taskStore && taskId) {
      fireAndForget(() => {
        failTask(taskStore, taskId, errorMsg);
      });
    }

    return result;
  }
}
