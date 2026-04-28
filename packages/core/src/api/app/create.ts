// ============================================================
// App Create - Agent 创建入口（新 API）
// ============================================================

import type { CreateAgentOptions, CreateAgentResult, AppContext } from './types';
import type { SubAgentStreamWriter } from '../../extensions/subagents';
import { createChatAgent } from '../../runtime/agent/create';

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

  // 直接从 context 取数据，不重复加载
  const { skills, mcps, memory, permissions, agents, cwd } = context;

  // 创建 Agent，传递 preloadedData
  const result = await createChatAgent({
    conversationId,
    messages,
    userId,
    modelConfig: {
      apiKey: options.model.apiKey,
      baseURL: options.model.baseURL,
      modelName: options.model.modelName,
      includeUsage: options.model.includeUsage ?? true,
    },
    sessionOptions: {
      projectDir: cwd,
      maxContextTokens: options.session?.maxContextTokens,
      maxBudgetUsd: options.session?.maxBudgetUsd,
      compactThreshold: options.session?.compactThreshold,
      model: options.model.modelName,
    },
    enableMcp: options.modules?.mcps ?? true,
    enableSkills: options.modules?.skills ?? true,
    enableMemory: options.modules?.memory ?? true,
    enableConnector: options.modules?.connectors ?? true,
    writerRef: options.writerRef as { current: SubAgentStreamWriter | null } | undefined,
    // 传递预加载数据，避免重复 loadAll
    preloadedData: {
      cwd,
      skills: [...skills], // 转换为可变数组
      agents: [...agents],
      mcps: [...mcps],
      connectors: [...context.connectors],
      permissions: [...permissions],
      memory: [...memory],
    },
  });

  return result as CreateAgentResult;
}