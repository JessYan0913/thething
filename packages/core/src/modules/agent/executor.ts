import { ToolLoopAgent, generateText } from 'ai';
import type { PrepareStepFunction, PrepareStepResult, StopCondition, ToolSet, ModelMessage } from 'ai';
import type { AgentDefinition, AgentExecutionContext, AgentExecutionResult } from './types';
import type { CompactionConfig} from '../../services/config/compaction-types';
import { manageToolOutputLifecycle } from '../compaction/lifecycle';
import { resolveToolsForAgent } from './tool-resolver';
import { resolveModelForAgent } from './model-resolver';
import { buildSubAgentPrompt, buildContextPrompt } from './context-builder';
import { completeTodo, failTodo, updateTodoStatus } from '../../modules/todos';
import { logger } from '../../primitives/logger';

// ============================================================
// Helper Functions
// ============================================================

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

/**
 * 提取子 Agent 交付物（结论）。
 * Output Guidelines 要求子Agent 以 "## Final Conclusion" 标题收尾，该段是父Agent 要读的结论。
 * textContent 是全程所有 text-delta 的拼接，含过程叙述；这里提取最后一个 Final Conclusion 段
 * 作为交付物，避免把过程日志原样返回父Agent。子Agent 未按指令写标题时回退到全文原文（不劣化）。
 *
 * @internal 导出仅用于测试
 */
export function extractSubAgentDeliverable(textContent: string): string {
  const FINAL_CONCLUSION_HEADING = '## Final Conclusion';
  const conclusionStart = textContent.lastIndexOf(FINAL_CONCLUSION_HEADING);
  if (conclusionStart === -1) return textContent;
  return textContent.slice(conclusionStart + FINAL_CONCLUSION_HEADING.length).trim();
}

/**
 * 判断子 Agent 是否按输出契约交付了结论。以 "## Final Conclusion" 标题为客观锚点，
 * 不判内容质量（符合"系统不替 LLM 判定质量"哲学）。用于决定是否触发强制摘要兜底：
 * 子 Agent 做了工具调用但没交付结论（残片/纯过程叙述）时，必须兜底保证结论。
 *
 * @internal 导出仅用于测试
 */
export function hasFinalConclusion(textContent: string): boolean {
  return textContent.includes('## Final Conclusion');
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
  const { toolCallId, writerRef, abortSignal, todoStore, todoId, agentRunStore, conversationId, scheduler, executionMode } = context;
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

    // 4. 创建 ToolLoopAgent。
    // 设计决策（2026-08-18）：不设步数上限（isStepCount），让子Agent 自主判断任务何时完成、
    // 自行决定是否输出最终结论——系统只提供运行环境，不替 LLM 决定何时停止。
    // 仅保留可选的 token 预算停止（成本护栏，非"完成判定"）。
    const stopWhen: StopCondition<ToolSet>[] = [];
    if (context.maxTotalTokens && context.maxTotalTokens > 0) {
      stopWhen.push(isTokenBudgetExceeded(context.maxTotalTokens));
    }
    const subAgent = new ToolLoopAgent({
      model,
      instructions,
      tools: context.parentTools,
      activeTools,
      stopWhen,
      // 设计决策（2026-08-18）：不设 maxOutputTokens 输出上限——让 provider 走自身默认，
      // 不强制截断子 Agent 的结论文本。实测子 Agent 输出仅 1.7k–4.3k，从没触到旧 8000 上限；
      // 输出长度交给 LLM 自主（上下文由 Layer 2 落盘管理）。若未来某 thinking 模型需护栏再回归。
      // Layer 2 压缩：每步 API 调用前将旧工具输出替换为结构化元信息
      ...(context.compactionConfig
        ? { prepareStep: createSubAgentPrepareStep(context.compactionConfig) }
        : {}),
    });

    // 5. 构建初始 prompt（注入父对话上下文，让子 Agent 知道任务背景）
    const initialPrompt = context.parentMessages.length > 0
      ? buildContextPrompt(context, task)
      : task;

    // 7. 更新任务状态（统一写入口：有 runtime 经 runtime.claimTodo；无则回落 store 直写）
    if (todoStore && todoId) {
      // 并行路径需每任务独立 agentId（展示用 claimedBy；账本化后无 busy/单进行中/依赖闸门）。
      const isParallel = executionMode === 'parallel_agent';
      const subAgentId = isParallel ? `parallel:${todoId}` : (definition.agentType ?? 'sub_agent');
      if (scheduler) {
        try {
          scheduler.claimTodo(todoId, {
            agentId: subAgentId,
            mode: executionMode ?? 'main_agent',
            ...(isParallel ? { allowParallel: true } : {}),
          });
        } catch (claimErr) {
          // blocked/illegal claim 不作为崩溃，抛给外层记失败
          throw claimErr;
        }
      } else {
        updateTodoStatus(todoStore, todoId, 'in_progress');
      }
    }

    // 8. 执行流式输出
    const streamResult = await subAgent.stream({
      prompt: initialPrompt,
      abortSignal,
    });

    // 9. 处理输出流
    const toolResults: Array<{ name: string; input: unknown; output: string }> = [];
    // 子流内部 toolCallId → 步骤序号，用于 tool-result 与 tool-call 配对
    //（一个 step 可能并行发起多个 tool-call，不能用 stepsExecuted 当时值配对）
    const stepSeqByCallId = new Map<string, number>();

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
        stepSeqByCallId.set(part.toolCallId, stepsExecuted);
        // step 事件用唯一 id（`${toolCallId}#${seq}`）：AI SDK 对同 type+同 id
        // 的 data part 是替换语义，共用 id 会导致前端只剩最后一步。
        writer?.write({
          type: 'data-sub-tool-call',
          id: `${toolCallId}#${stepsExecuted}`,
          data: { name: part.toolName, input: part.input, seq: stepsExecuted },
        });
      }
      if (part.type === 'tool-result') {
        const output =
          typeof part.output === 'string'
            ? part.output
            : JSON.stringify(part.output).slice(0, 200);
        // 保存工具结果用于强制摘要
        toolResults.push({ name: part.toolName, input: part.input, output: output.slice(0, 2000) });
        // 与对应 tool-call 同 seq 同 id（type 不同不冲突），前端按 id 配对
        const seq = stepSeqByCallId.get(part.toolCallId) ?? stepsExecuted;
        writer?.write({
          type: 'data-sub-tool-result',
          id: `${toolCallId}#${seq}`,
          data: { name: part.toolName, result: output, seq },
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

    // 10. 强制摘要：子 Agent 做了工具调用但没按契约交付 ## Final Conclusion（可能只有残片、
    // 纯过程叙述，或被截断）时，追加一次无工具的 LLM 调用，把收集到的工具结果汇总成结论。
    // 这是子 Agent 返回值的最后防线——没有它，父 Agent 只能拿到 "completed N steps" 的零信息
    // fallback 或残片文本，子 Agent 的工作全部丢失。有 Final Conclusion 时信任子 Agent 自身输出。
    if (stepsExecuted > 0 && !hasFinalConclusion(textContent)) {
      try {
        // 将工具结果格式化为上下文，让摘要调用能看到收集到的数据
        const toolContext = toolResults
          .map((r, i) => `--- Result ${i + 1} (${r.name}) ---\n${r.output}`)
          .join('\n\n')
          .slice(0, 8000); // 限制总长度避免超上下文

        const summaryPrompt =
          `You just completed ${stepsExecuted} tool calls (${[...new Set(toolsUsed)].join(', ')}). ` +
          `However, you did not produce a final conclusion in the required ## Final Conclusion format. ` +
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

    // 12. 构建结果。
    // extractSubAgentDeliverable 提取 Final Conclusion 段作为交付物（见该函数注释），
    // 避免把全程过程叙述原样返回父Agent；未写标题时回退到全文原文。若上面触发了强制摘要，
    // 此时 textContent 已被替换为生成的结论（无标题 → 回退返回全文即该结论），保证有实质交付。
    const deliverable = extractSubAgentDeliverable(textContent);

    const fallbackSummary = stepsExecuted > 0
      ? `Agent completed ${stepsExecuted} tool calls using ${[...new Set(toolsUsed)].join(', ')}. No text summary was produced.`
      : 'Agent completed with no text output.';

    const result: AgentExecutionResult = {
      success: true,
      summary: deliverable || fallbackSummary,
      durationMs: duration,
      tokenUsage,
      stepsExecuted,
      toolsUsed: [...new Set(toolsUsed)],
      status: 'completed',
    };

    // 12. 完成任务（如果有）。同步完成（设计指令：消除 fire-and-forget 竞态）——
    //    确保 todo 状态在父 Agent 下一步 prepareStep 读取前已落库。
    //    One Canvas：子任务完成结果经 metadata.result 自然携带，下一轮画布展示（无边界整段重建）。
    if (todoStore && todoId) {
      // 可观测：路径 B 完成（executor 直接写库，不经 todo-write-tool）
      logger.info('SubAgent', `[path-b-complete] todoId=${todoId}`);
      if (scheduler) {
        scheduler.completeTodo(todoId, result.summary);
      } else {
        completeTodo(todoStore, todoId, result.summary);
      }
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
      if (scheduler) {
        scheduler.failTodo(todoId, errorMsg);
      } else {
        failTodo(todoStore, todoId, errorMsg);
      }
    }

    // 标记 run 失败
    if (agentRunStore && conversationId) {
      agentRunStore.failRun(conversationId, errorMsg);
    }

    return result;
  }
}