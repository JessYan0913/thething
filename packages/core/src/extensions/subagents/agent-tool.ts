import { tool } from 'ai';
import { z } from 'zod';
import { globalAgentRegistry } from './registry';
import { resolveAgentRoute } from './router';
import { executeRoutedAgent } from './executor';
import { scanAgentDirs } from './loader';
import { checkRecursionGuard, RecursionTracker } from './recursion-guard';
import { detectProjectDir } from '../../foundation/paths';
import type { AgentToolConfig, AgentExecutionContext, AgentExecutionResult, AgentToolInput } from './types';

// ============================================================
// Agent Tool Input Schema
// ============================================================

const AgentToolInputSchema = z.object({
  agentType: z.string().optional().describe(
    'Agent type to use. Built-in: explore, research, plan, general-purpose. ' +
    'Custom agents (like test-agent) are already loaded and can be used directly by name. ' +
    'Example: "test-agent" for a custom agent defined in .thething/agents/test-agent.md. ' +
    'If not specified, auto-routes based on task keywords.'
  ),
  task: z.string().describe('The task for the sub-agent to complete'),
});

// ============================================================
// Recursion Tracker
// ============================================================

const tracker = new RecursionTracker();

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
  const cwd = config.cwd ?? detectProjectDir();

  // 动态生成 agent 列表描述
  const registeredAgents = globalAgentRegistry.getAll();
  const agentList = registeredAgents
    .map(a => {
      const sourceTag = a.source === 'builtin' ? '' : ` (${a.source})`;
      return `- **${a.agentType}**${sourceTag}: ${a.description}`;
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

    execute: async ({ agentType, task }: AgentToolInput, options) => {
      const startTime = Date.now();
      const toolCallId = options.toolCallId ?? `agent-${Date.now()}`;
      const abortSignal = options.abortSignal;
      const writer = config.writerRef?.current ?? null;

      const depth = config.recursionDepth ?? 0;
      tracker.enter(toolCallId);

      try {
        // 递归检查
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

        // 动态加载 Agent（如果指定了类型但未注册）
        if (agentType && !globalAgentRegistry.has(agentType)) {
          const customAgents = await scanAgentDirs(cwd);
          for (const agent of customAgents) {
            if (!globalAgentRegistry.has(agent.agentType)) {
              globalAgentRegistry.register(agent);
            }
          }
        }

        // 广播开始事件
        writer?.write({
          type: 'data-sub-open',
          id: toolCallId,
          data: { agentType: agentType ?? 'auto', task },
        });

        // 构建执行上下文
        const context: AgentExecutionContext = {
          parentTools: config.parentTools,
          parentModel: config.parentModel,
          parentSystemPrompt: config.parentSystemPrompt,
          parentMessages: config.parentMessages,
          writerRef: config.writerRef,
          abortSignal: abortSignal ?? new AbortController().signal,
          toolCallId,
          recursionDepth: depth,
          taskStore: config.taskStore,
          taskId: config.taskId,
          provider: config.provider,
          cwd,
        };

        // 路由决策
        const routeDecision = resolveAgentRoute({ agentType, task }, context);

        console.log(
          `[AgentTool] Routing to ${routeDecision.type} (${routeDecision.definition.agentType})`,
          `| Reason: ${routeDecision.reason}`,
          `| Depth: ${depth}`
        );

        // 执行 Agent
        const result = await executeRoutedAgent(
          routeDecision.definition,
          context,
          task
        );

        tracker.exit(toolCallId);

        // 广播完成事件
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
        } as AgentExecutionResult;
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
    `   Steps: ${result.stepsExecuted}`,
    `   Tools: ${result.toolsUsed.join(', ')}`,
  ];

  if (result.tokenUsage) {
    lines.push(`   Tokens: ${result.tokenUsage.totalTokens} (in: ${result.tokenUsage.inputTokens}, out: ${result.tokenUsage.outputTokens})`);
  }

  return lines.join('\n');
}