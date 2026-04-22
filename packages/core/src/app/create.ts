// ============================================================
// App Create - Agent 创建入口
// ============================================================

import type { CreateAgentOptions, CreateAgentResult, AppContext } from './types';
import { detectProjectDir } from '../paths';
import type { SubAgentStreamWriter } from '../subagents';

// 暂时导出现有 createChatAgent 的别名
// 后续需要重构以整合 context
export { createChatAgent } from '../agent/create';

/**
 * 创建 Agent（新 API）
 *
 * @param options 创建选项
 * @returns CreateAgentResult
 */
export async function createAgent(options?: CreateAgentOptions): Promise<CreateAgentResult> {
  // 如果传入 context，直接使用
  // 否则创建新 context
  const cwd = options?.cwd ?? detectProjectDir();

  // 暂时使用现有 createChatAgent
  // 后续重构以整合 AppContext
  const { createChatAgent } = await import('../agent/create');

  // 生成默认 conversationId
  const conversationId = options?.conversationId ?? `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // 转换参数格式
  const result = await createChatAgent({
    conversationId,
    messages: options?.messages,
    userId: options?.userId,
    modelConfig: {
      apiKey: options?.model?.apiKey ?? process.env.DASHSCOPE_API_KEY ?? '',
      baseURL: options?.model?.baseURL ?? process.env.DASHSCOPE_BASE_URL ?? '',
      modelName: options?.model?.modelName ?? process.env.DASHSCOPE_MODEL_NAME ?? 'qwen-max',
      includeUsage: options?.model?.includeUsage ?? true,
    },
    sessionOptions: {
      projectDir: cwd,
      maxContextTokens: options?.session?.maxContextTokens,
      maxBudgetUsd: options?.session?.maxBudgetUsd,
      compactThreshold: options?.session?.compactThreshold,
    },
    enableMcp: options?.modules?.mcps ?? true,
    enableSkills: options?.modules?.skills ?? true,
    enableMemory: options?.modules?.memory ?? true,
    enableConnector: options?.modules?.connectors ?? true,
    writerRef: options?.writerRef as { current: SubAgentStreamWriter | null },
  });

  return result as CreateAgentResult;
}