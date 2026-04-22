import { ToolLoopAgent, stepCountIs } from 'ai';
import type { AgentDefinition, AgentExecutionContext, AgentExecutionResult } from './types';
import { resolveToolsForAgent } from './tool-resolver';
import { resolveModelForAgent } from './model-resolver';
import { buildSubAgentPrompt, buildContextPrompt } from './context-builder';
import { completeTask, failTask, updateTaskStatus } from '../tasks';

// ============================================================
// Helper Functions
// ============================================================

function fireAndForget<T>(fn: () => T): void {
  setTimeout(fn, 0);
}

// ============================================================
// Agent Executor
// ============================================================

/**
 * 执行路由后的 Agent
 *
 * @param definition Agent 定义
 * @param context 执行上下文
 * @param task 任务描述
 * @returns 执行结果
 */
export async function executeRoutedAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
  task: string,
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const { toolCallId, writerRef, abortSignal, taskStore, taskId } = context;
  const writer = writerRef.current;

  try {
    // 1. 解析工具
    const activeTools = resolveToolsForAgent(definition, context);

    // 2. 解析模型
    const model = resolveModelForAgent(definition, context);

    // 3. 构建 System Prompt
    const instructions = buildSubAgentPrompt(definition, context);

    // 4. 解析 maxTurns 和 stopWhen
    const maxTurns = definition.maxTurns ?? 20;
    const stopWhen = definition.stopWhen ?? [stepCountIs(maxTurns)];

    // 5. 创建 ToolLoopAgent
    const subAgent = new ToolLoopAgent({
      model,
      instructions,
      tools: context.parentTools,
      activeTools,
      stopWhen,
    });

    // 6. 构建初始 Prompt
    const initialPrompt = definition.includeParentContext
      ? buildContextPrompt(context, task)
      : task;

    // 7. 更新任务状态
    if (taskStore && taskId) {
      updateTaskStatus(taskStore, taskId, 'in_progress');
    }

    // 8. 执行流式输出
    const streamResult = await subAgent.stream({
      prompt: initialPrompt,
      abortSignal,
    });

    // 9. 处理输出流
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

    // 10. 获取 usage 统计
    const usage = await streamResult.usage;
    const duration = Date.now() - startTime;
    const tokenUsage = usage
      ? {
          inputTokens: Number(usage.inputTokens ?? 0),
          outputTokens: Number(usage.outputTokens ?? 0),
          totalTokens: Number(usage.totalTokens ?? 0),
        }
      : undefined;

    // 11. 构建结果
    const result: AgentExecutionResult = {
      success: true,
      summary: textContent || 'Agent completed with no text output.',
      durationMs: duration,
      tokenUsage,
      stepsExecuted,
      toolsUsed: [...new Set(toolsUsed)],
      status: 'completed',
    };

    // 12. 完成任务（如果有）
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