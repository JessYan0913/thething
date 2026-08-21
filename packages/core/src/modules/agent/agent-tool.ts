import { tool } from 'ai';
import { z } from 'zod';
import path from 'path';
import { AgentRegistry } from './registry';
import { resolveAgentRoute } from './router';
import { executeRoutedAgent } from './executor';
import { scanAgentDirs } from './loader';
import { isSubstantiveDeliverable } from './deliverable';
import { logger } from '../../primitives/logger';
import { resolveTodoReference } from '../todos';
import type { AgentToolConfig, AgentExecutionContext, AgentExecutionResult, AgentToolInput, AgentTaskExecutionOptions } from './types';

export async function executeAgentTask({
  agentType,
  task,
  config,
  toolCallId,
  abortSignal,
  todoId,
  includeParentMessages = true,
  modelOverride,
}: AgentTaskExecutionOptions): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const cwd = config.cwd ?? process.cwd();
  const writer = config.writerRef?.current ?? null;
  const agentRegistry = config.agentRegistry ?? new AgentRegistry();

  // 可观测：agent 工具调用计数 + todoId 占比（路径 B 废弃影响评估的数据源）
  logger.info('AgentTool', `[invoke] agentType=${agentType ?? 'auto'} todoId=${todoId ?? 'none'}`);

  for (const agent of config.agents ?? []) {
    if (!agentRegistry.has(agent.agentType)) {
      agentRegistry.register(agent);
    }
  }

  try {
    if (config.dynamicReload && agentType && !agentRegistry.has(agentType)) {
      const customAgents = await scanAgentDirs(cwd, { dirs: config.agentsLayoutDirs });
      for (const agent of customAgents) {
        if (!agentRegistry.has(agent.agentType)) {
          agentRegistry.register(agent);
        }
      }
    }

    writer?.write({
      type: 'data-sub-open',
      id: toolCallId,
      data: { agentType: agentType ?? 'auto', task },
    });

    const context: AgentExecutionContext = {
      parentTools: config.parentTools,
      connectorToolNames: config.connectorToolNames,
      parentModel: config.parentModel,
      parentSystemPrompt: config.parentSystemPrompt,
      parentMessages: includeParentMessages ? config.parentMessages : [],
      writerRef: config.writerRef,
      abortSignal: abortSignal ?? new AbortController().signal,
      toolCallId,
      todoStore: config.todoStore,
      scheduler: config.scheduler,
      executionMode: config.executionMode ?? 'agent',
      todoId: todoId ?? config.todoId,
      provider: config.provider,
      modelAliases: config.modelAliases,
      cwd,
      agentRegistry,
      compactionConfig: config.compactionConfig,
      maxTotalTokens: config.maxTotalTokens,
      maxOutputTokens: config.maxOutputTokens,
    };

    const routeDecision = resolveAgentRoute({ agentType, task }, context);
    const definition = modelOverride && modelOverride !== 'inherit'
      ? { ...routeDecision.definition, model: modelOverride }
      : routeDecision.definition;

    logger.debug(
      'AgentTool',
      `Routing to ${routeDecision.type} (${definition.agentType}) | Reason: ${routeDecision.reason}`,
    );

    const result = await executeRoutedAgent(definition, context, task);

    // P0 交付物校验（§1.3 待设计对齐）：子Agent 成功但无实质交付物（空/兜底文案）→ 降级，
    // 不把"跑完了但没交出结果"当作成功返回给主Agent。
    if (result.success && !isSubstantiveDeliverable(result.summary)) {
      logger.warn('AgentTool', `[no-deliverable] Agent ${definition.agentType} 未返回实质交付物，降级走主Agent执行`);
      writer?.write({
        type: 'data-sub-done',
        id: toolCallId,
        data: { success: false, durationMs: Date.now() - startTime, error: '交付物缺失', status: 'failed' },
      });
      return {
        success: false,
        summary: `Agent ${definition.agentType} 未返回实质交付物（只有过程日志或空结果），已降级：请用主Agent工具直接执行该任务，或重新委派并明确要求输出最终结论。`,
        durationMs: Date.now() - startTime,
        stepsExecuted: result.stepsExecuted,
        toolsUsed: result.toolsUsed,
        error: 'no deliverable',
        status: 'failed',
      };
    }

    writer?.write({
      type: 'data-sub-done',
      id: toolCallId,
      data: {
        success: result.success,
        durationMs: result.durationMs,
        agentType: definition.agentType,
        stepsExecuted: result.stepsExecuted,
        toolsUsed: result.toolsUsed,
        tokenUsage: result.tokenUsage,
        status: result.status,
      },
    });

    return result;
  } catch (error) {
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
}

// ============================================================
// Agent Tool Factory
// ============================================================

/**
 * 创建 Agent 工具
 *
 * 这是统一的入口，用于创建可以被主 Agent 使用的 Agent 工具。
 *
 * @param config Agent 工具配置
 * @returns Tool 对象
 */
export function createAgentTool(config: AgentToolConfig) {
  const cwd = config.cwd ?? process.cwd();
  const agentRegistry = config.agentRegistry ?? new AgentRegistry();
  for (const agent of config.agents ?? []) {
    if (!agentRegistry.has(agent.agentType)) {
      agentRegistry.register(agent);
    }
  }

  const configDirName = path.basename(config.configDir);

  // 能力边界自动推导：写文件能力只看 write_file/edit_file/bash（bash 能 echo >/cat > 写文件），
  // web_fetch 单列。标注随工具集客观事实走，不靠手写 metadata 维护。
  // 后缀（括号内）是给 LLM 选型用的能力边界提示，不影响前面 `能力：{标签}` 的客观标签。
  const deriveCapability = (tools: string[] | undefined): string => {
    const canWrite = tools?.some((t) => ['write_file', 'edit_file', 'bash'].includes(t)) ?? false;
    const hasWeb = tools?.includes('web_fetch') ?? false;
    if (canWrite) return hasWeb ? '可写文件（全工具）' : '可写文件（可改文件，无 web）';
    return hasWeb ? '只读 + web（可联网调研，不写文件）' : '只读（不写文件、不联网）';
  };

  // 动态生成 input schema（使用正确的 configDirName）
  const AgentToolInputSchema = z.object({
    agentType: z.string().optional().describe(
      'Agent type to use. MUST choose EXPLICITLY based on the task and each agent capability (see "Currently available agents"). ' +
      'Built-in: explore (只读查找), research (只读+web 调研), plan (只读规划), general-purpose (可写文件+web 全能力). ' +
      'Custom agents (like test-agent) are already loaded and can be used directly by name. ' +
      `Example: "test-agent" for a custom agent defined in ${configDirName}/agents/test-agent.md. ` +
      'The system does NOT auto-route. Leave blank only if you intend general-purpose execution.'
    ),
    task: z.string().describe('The task for the sub-agent to complete'),
    todo: z.string().optional().describe(
      'Reference to the todo this task corresponds to: its list index like [#3], or its exact title. When it resolves to a task, that todo is automatically marked in_progress on start and completed/failed on finish — no manual status update needed.'
    ),
  });

  // 动态生成 agent 列表描述：只暴露可自动委派子Agent（metadata.isSubAgentAvailable），
  // 不暴露全量列表——自动委派由系统决定（§12），模型不应看到不可委派 Agent。
  const registeredAgents = agentRegistry.getAll();
  const delegatableAgents = registeredAgents.filter((a) => {
    const metadata = a.metadata as Record<string, unknown> | undefined;
    return metadata?.isSubAgentAvailable === true;
  });
  const agentList = delegatableAgents.length > 0
    ? delegatableAgents
        .map(a => {
          const sourceTag = a.source === 'builtin' ? '' : ` (${a.source})`;
          const brief = a.instructions.split('\n')[0]?.slice(0, 80) ?? '';
          const tools = a.tools?.length ? a.tools.join(', ') : '（无工具）';
          return `- **${a.agentType}**${sourceTag}: ${brief}\n  工具：${tools} | 能力：${deriveCapability(a.tools)}`;
        })
        .join('\n')
    : '（当前无可自动委派子Agent；agentType 留空时走通用执行，或按需手动指定）';

  return tool({
    description: `Delegate a task to a specialized sub-agent.

IMPORTANT: All agents are ALREADY loaded and registered. Do NOT search for agent definition files - just call this tool with the agentType parameter.

You MUST choose agentType EXPLICITLY — the system does NOT auto-route for you. Each agent below lists its 适用场景 / 工具 / 能力边界; pick the one that best fits the task.

Currently available agents:
${agentList}

Usage example: When user says "use test-agent to verify", call this tool with {agentType: "test-agent", task: "verify"} - do NOT use Glob/Read to find files.

Leave agentType blank only if you intend general-purpose execution (全工具).`,
    inputSchema: AgentToolInputSchema,

    execute: async ({ agentType, task, todo }: AgentToolInput, options) => {
      // 方案 C：模型面用编号/标题引用任务，此处解析为内部 todoId 供 Path B 状态同步
      const todoId = todo && config.todoStore && config.conversationId
        ? resolveTodoReference(config.todoStore, config.conversationId, todo)
        : undefined;
      return executeAgentTask({
        agentType,
        task,
        todoId,
        config: { ...config, agentRegistry },
        toolCallId: options.toolCallId ?? `agent-${Date.now()}`,
        abortSignal: options.abortSignal,
      });
    },

    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'summary' in output) {
        const result = output as AgentExecutionResult;
        return { type: 'text' as const, value: result.summary };
      }
      // 设计决策（A2，2026-08-18）：子 Agent 未返回可读 summary 时，不注入
      // "Task completed." 假话——如实透传空态，让父 Agent 能区分正常完成与无返回结论。
      return { type: 'text' as const, value: '(子Agent 未返回结论文本)' };
    },
  });
}

// ============================================================
// Agent Tool Result Helpers
// ============================================================

/**
 * 格式化 Agent 执行结果为用户友好文本
 */
export function formatAgentResult(result: AgentExecutionResult): string {
  if (!result.success) {
    return `❌ Agent failed: ${result.error ?? 'Unknown error'}`;
  }

  const lines = [
    `✅ Task completed in ${result.durationMs}ms`,
    `   Tool calls: ${result.stepsExecuted}`,
    `   Tools: ${result.toolsUsed.join(', ')}`,
  ];

  if (result.tokenUsage) {
    lines.push(`   Tokens: ${result.tokenUsage.totalTokens} (in: ${result.tokenUsage.inputTokens}, out: ${result.tokenUsage.outputTokens})`);
  }

  return lines.join('\n');
}
