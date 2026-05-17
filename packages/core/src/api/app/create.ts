// ============================================================
// App Create - Agent 创建入口（新 API）
// ============================================================

import type { CreateAgentOptions, CreateAgentResult } from './types';
import type { SubAgentStreamWriter } from '../../extensions/subagents';
import { createChatAgent } from '../../runtime/agent/create';
import { resolveAgentConfig } from './resolve-agent-config';

// ============================================================
// createAgent - 消费 AppContext
// ============================================================

/**
 * 创建 Agent。消费 AppContext，不再内部重新加载资源。
 *
 * 设计约束：
 * - 必须提供 context（已加载配置快照）
 * - model 参数必填（不从环境变量隐式读取）
 * - 不调用 loadAll（资源已在 context 中）
 * - 不修改全局状态
 *
 * @param options 创建选项（context 必填）
 * @returns CreateAgentResult
 */
export async function createAgent(options: CreateAgentOptions): Promise<CreateAgentResult> {
  const { context, conversationId, messages = [], userId = 'default' } = options;
  const { skills, mcps, memory, permissions, agents, layout } = context;

  // 统一解析配置 — 一次性产出 ResolvedAgentConfig，不再逐字段拼装
  const resolved = resolveAgentConfig(options);

  // 创建 Agent，传递 preloadedData 和 resolvedConfig
  const result = await createChatAgent({
    conversationId,
    messages,
    userId,
    // 传递对话元数据（用于控制技能附件注入等行为）
    conversationMeta: options.conversationMeta ? {
      messageCount: messages.length,
      isNewConversation: options.conversationMeta.isNewConversation,
      conversationStartTime: options.conversationMeta.conversationStartTime ?? Date.now(),
    } : undefined,
    writerRef: options.writerRef as { current: SubAgentStreamWriter | null } | undefined,
    webSearchApiKey: context.runtime.env.EXA_API_KEY,
    debugEnabled: Boolean(context.runtime.env.DEBUG),
    // 传递预加载数据，避免重复 loadAll
    preloadedData: {
      layout,
      skills: [...skills],
      agents: [...agents],
      mcps: [...mcps],
      connectors: [...context.connectors],
      permissions: [...permissions],
      memory: [...memory],
      dataStore: context.runtime.dataStore,
      connectorRegistry: context.runtime.connectorRegistry,
    },
    // 统一解析后的配置 — runtime 原样消费
    resolvedConfig: resolved,
  });

  return result as CreateAgentResult;
}
