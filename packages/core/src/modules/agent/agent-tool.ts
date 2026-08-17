import { tool } from 'ai';
import { z } from 'zod';
import path from 'path';
import { AgentRegistry } from './registry';
import { resolveAgentRoute } from './router';
import { executeRoutedAgent } from './executor';
import { scanAgentDirs } from './loader';
import { logger } from '../../primitives/logger';
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

  // 动态生成 input schema（使用正确的 configDirName）
  const AgentToolInputSchema = z.object({
    agentType: z.string().optional().describe(
      'Agent type to use. Built-in: explore, research, plan, general-purpose. ' +
      'Custom agents (like test-agent) are already loaded and can be used directly by name. ' +
      `Example: "test-agent" for a custom agent defined in ${configDirName}/agents/test-agent.md. ` +
      'If not specified, auto-routes based on task keywords.'
    ),
    task: z.string().describe('The task for the sub-agent to complete'),
    todoId: z.string().optional().describe(
      'ID of the todo this task corresponds to. When provided, the todo is automatically marked in_progress on start and completed/failed on finish — no manual status update needed.'
    ),
  });

  // 动态生成 agent 列表描述
  const registeredAgents = agentRegistry.getAll();
  const agentList = registeredAgents
    .map(a => {
      const sourceTag = a.source === 'builtin' ? '' : ` (${a.source})`;
      const brief = a.instructions.split('\n')[0]?.slice(0, 80) ?? '';
      return `- **${a.agentType}**${sourceTag}: ${brief}`;
    })
    .join('\n');

  return tool({
    description: `Delegate a task to a specialized sub-agent.

IMPORTANT: All agents are ALREADY loaded and registered. Do NOT search for agent definition files - just call this tool with the agentType parameter.

Currently available agents:
${agentList}

Usage example: When user says "use test-agent to verify", call this tool with {agentType: "test-agent", task: "verify"} - do NOT use Glob/Read to find files.

If no agentType specified, will auto-route based on task keywords (find→explore, research→research, plan→plan).`,
    inputSchema: AgentToolInputSchema,

    execute: async ({ agentType, task, todoId }: AgentToolInput, options) => executeAgentTask({
      agentType,
      task,
      todoId,
      config: { ...config, agentRegistry },
      toolCallId: options.toolCallId ?? `agent-${Date.now()}`,
      abortSignal: options.abortSignal,
    }),

    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'summary' in output) {
        const result = output as AgentExecutionResult;
        return { type: 'text' as const, value: result.summary };
      }
      return { type: 'text' as const, value: 'Task completed.' };
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
