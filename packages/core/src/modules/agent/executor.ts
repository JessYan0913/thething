import { ToolLoopAgent, isStepCount } from 'ai';
import type { AgentDefinition, AgentExecutionContext, AgentExecutionResult } from './types';
import { resolveToolsForAgent } from './tool-resolver';
import { resolveModelForAgent } from './model-resolver';
import { buildSubAgentPrompt, buildContextPrompt } from './context-builder';
import { completeTodo, failTodo, updateTodoStatus } from '../../modules/todos';

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
  const { toolCallId, writerRef, abortSignal, todoStore, todoId } = context;
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
    const stopWhen = definition.stopWhen ?? [isStepCount(maxTurns)];

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
    if (todoStore && todoId) {
      updateTodoStatus(todoStore, todoId, 'in_progress');
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
    const toolResults: Array<{ name: string; input: unknown; output: string }> = [];

    for await (const part of streamResult.stream) {
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
        // 保存工具结果用于强制摘要
        toolResults.push({ name: part.toolName, input: part.input, output: output.slice(0, 2000) });
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

    // 11. 强制摘要：当 summarizeOutput=true 但 agent 没有产出文本时，
    //     追加一次无工具的 LLM 调用，让它基于已有上下文写总结
    if (!textContent && stepsExecuted > 0 && definition.summarizeOutput !== false) {
      try {
        // 将工具结果格式化为上下文，让摘要 agent 能看到收集到的数据
        const toolContext = toolResults
          .map((r, i) => `--- Result ${i + 1} (${r.name}) ---\n${r.output}`)
          .join('\n\n')
          .slice(0, 8000); // 限制总长度避免超上下文

        const summaryPrompt =
          `You just completed ${stepsExecuted} tool calls (${[...new Set(toolsUsed)].join(', ')}). ` +
          `However, you did not produce any text output during those calls. ` +
          `Here are the results you gathered:\n\n${toolContext}\n\n` +
          `Based on the above information, write a concise summary of your findings. ` +
          `Do NOT make any more tool calls — only write text.`;

        const summaryAgent = new ToolLoopAgent({
          model,
          instructions: 'You must produce a text summary. Do NOT use any tools.',
          tools: context.parentTools,
          activeTools: [], // 禁用所有工具
          stopWhen: [isStepCount(1)],
        });

        const summaryResult = await summaryAgent.stream({
          prompt: summaryPrompt,
          abortSignal,
        });

        for await (const part of summaryResult.stream) {
          if (part.type === 'text-delta') {
            textContent += part.text;
          }
        }
      } catch {
        // 摘要失败不影响主结果
      }
    }

    // 12. 构建结果
    const fallbackSummary = stepsExecuted > 0
      ? `Agent completed ${stepsExecuted} steps using ${[...new Set(toolsUsed)].join(', ')}. No text summary was produced.`
      : 'Agent completed with no text output.';

    const result: AgentExecutionResult = {
      success: true,
      summary: textContent || fallbackSummary,
      durationMs: duration,
      tokenUsage,
      stepsExecuted,
      toolsUsed: [...new Set(toolsUsed)],
      status: 'completed',
    };

    // 12. 完成任务（如果有）
    if (todoStore && todoId) {
      fireAndForget(() => {
        completeTodo(todoStore, todoId, result.summary);
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

    if (todoStore && todoId) {
      fireAndForget(() => {
        failTodo(todoStore, todoId, errorMsg);
      });
    }

    return result;
  }
}