import { ToolLoopAgent, isStepCount, generateText } from 'ai';
import type { PrepareStepFunction, PrepareStepResult, StopCondition, ToolSet, ModelMessage } from 'ai';
import type { AgentDefinition, AgentExecutionContext, AgentExecutionResult } from './types';
import type { CompactionConfig} from '../../services/config/compaction-types';
import { manageToolOutputLifecycle } from '../compaction/lifecycle';
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

/** 子 Agent 默认最大步数 */
const SUB_AGENT_MAX_STEPS = 20;

/**
 * 子 Agent 的 prepareStep：每步 API 调用前执行 Layer 2 压缩
 * （工具输出生命周期管理，同步、微秒级）。
 *
 * 不做 Layer 3（LLM 摘要）——子 Agent 最多 20 步，上下文短，
 * 额外 LLM 调用的延迟和成本不值得。
 * 不传 storage——落盘找回只对父 Agent 上下文有意义。
 *
 * @internal 导出仅用于测试
 */
export function createSubAgentPrepareStep(
  compactionConfig: CompactionConfig,
): PrepareStepFunction<ToolSet> {
  return ({ messages }) => {
    const result = manageToolOutputLifecycle(
      messages as import('ai').ModelMessage[],
      compactionConfig.lifecycle,
    );
    return {
      messages: result.messages as ModelMessage[],
    } as PrepareStepResult<ToolSet>;
  };
}

/**
 * token 预算停止条件：所有已完成步骤的真实 usage 累计超过上限时停止。
 * 用 SDK 的 stopWhen 而非消费端 break——后者只停止读流，
 * 不会终止 SDK 内部的 tool loop。
 *
 * @internal 导出仅用于测试
 */
export function isTokenBudgetExceeded(maxTotalTokens: number): StopCondition<ToolSet> {
  return ({ steps }) =>
    steps.reduce((sum, step) => sum + Number(step.usage?.totalTokens ?? 0), 0) >= maxTotalTokens;
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
  const { toolCallId, writerRef, abortSignal, todoStore, todoId, agentRunStore, conversationId } = context;
  const writer = writerRef.current;

  try {
    // 0. 初始化 run 记录（checkpoint 供进程崩溃后的诊断/展示用）。
    // 注意：这里不做"断点续跑"——ToolLoopAgent 总是从头执行完整 task，
    // 预载旧 run 的 accumulatedText/stepCount 只会导致文本重复拼接和
    // 步数双倍计数。发现残留的 running 态 run（进程中断遗留）时，
    // 直接覆盖重建，重新完整执行。
    let textContent = '';
    let stepsExecuted = 0;
    const toolsUsed: string[] = [];

    if (agentRunStore && conversationId) {
      const existingRun = agentRunStore.getRun(conversationId);
      // 'paused_approval' 状态不覆盖，由审批恢复逻辑处理
      if (existingRun?.status !== 'paused_approval') {
        agentRunStore.createRun(conversationId);
      }
    }

    // 1. 解析工具
    const activeTools = resolveToolsForAgent(definition, context);

    // 2. 解析模型
    const model = resolveModelForAgent(definition, context);

    // 3. 构建 System Prompt
    const instructions = buildSubAgentPrompt(definition, context);

    // 4. 创建 ToolLoopAgent（默认 20 轮 + 可选 token 预算上限）
    const stopWhen: StopCondition<ToolSet>[] = [isStepCount(SUB_AGENT_MAX_STEPS)];
    if (context.maxTotalTokens && context.maxTotalTokens > 0) {
      stopWhen.push(isTokenBudgetExceeded(context.maxTotalTokens));
    }
    const subAgent = new ToolLoopAgent({
      model,
      instructions,
      tools: context.parentTools,
      activeTools,
      stopWhen,
      // Layer 2 压缩：每步 API 调用前将旧工具输出替换为结构化元信息
      ...(context.compactionConfig
        ? { prepareStep: createSubAgentPrepareStep(context.compactionConfig) }
        : {}),
    });

    // 5. 构建初始 prompt（注入父对话上下文，让子 Agent 知道任务背景）
    const initialPrompt = context.parentMessages.length > 0
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

        // 写入 checkpoint（每完成一步更新一次）
        if (agentRunStore && conversationId) {
          agentRunStore.updateRun(conversationId, {
            stepCount: stepsExecuted,
            accumulatedText: textContent,
            toolsUsed: [...new Set(toolsUsed)],
          });
        }
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

    // 10. 强制摘要：当 agent 没有产出文本时，追加一次无工具的 LLM 调用写总结。
    // 这是子 Agent 返回值的最后防线——没有它，父 Agent 只能拿到
    // "completed N steps" 的零信息 fallback，子 Agent 的工作全部丢失。
    if (!textContent && stepsExecuted > 0) {
      try {
        // 将工具结果格式化为上下文，让摘要调用能看到收集到的数据
        const toolContext = toolResults
          .map((r, i) => `--- Result ${i + 1} (${r.name}) ---\n${r.output}`)
          .join('\n\n')
          .slice(0, 8000); // 限制总长度避免超上下文

        const summaryPrompt =
          `You just completed ${stepsExecuted} tool calls (${[...new Set(toolsUsed)].join(', ')}). ` +
          `However, you did not produce any text output during those calls. ` +
          `Here are the results you gathered:\n\n${toolContext}\n\n` +
          `Based on the above information, write a concise summary of your findings.`;

        const summaryResult = await generateText({
          model,
          instructions: 'You must produce a text summary. Do NOT use any tools.',
          prompt: summaryPrompt,
          abortSignal,
        });
        textContent = summaryResult.text;

        // 摘要调用的 token 也计入统计，避免成本漏报
        if (tokenUsage && summaryResult.usage) {
          tokenUsage.inputTokens += Number(summaryResult.usage.inputTokens ?? 0);
          tokenUsage.outputTokens += Number(summaryResult.usage.outputTokens ?? 0);
          tokenUsage.totalTokens += Number(summaryResult.usage.totalTokens ?? 0);
        }
      } catch {
        // 摘要失败不影响主结果
      }
    }

    // 12. 构建结果
    const fallbackSummary = stepsExecuted > 0
      ? `Agent completed ${stepsExecuted} tool calls using ${[...new Set(toolsUsed)].join(', ')}. No text summary was produced.`
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

    // 13. 标记 run 完成
    if (agentRunStore && conversationId) {
      agentRunStore.completeRun(conversationId);
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

    // 标记 run 失败
    if (agentRunStore && conversationId) {
      agentRunStore.failRun(conversationId, errorMsg);
    }

    return result;
  }
}