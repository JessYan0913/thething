import type { AgentDefinition, AgentExecutionContext, LanguageModel } from './types';
import { resolveModelAlias } from '../../services/model';
import { logger } from '../../primitives/logger';

/**
 * 解析 Agent 使用的模型
 *
 * 优先级：
 * 1. definition.model 如果是 LanguageModel 对象，直接使用
 * 2. 'inherit' - 使用 parentModel
 * 3. 'fast' / 'smart' - 通过 provider 创建
 * 4. 具体模型名 - 通过 provider 创建
 * 5. 未指定 - 使用 parentModel
 *
 * @param definition Agent 定义
 * @param context 执行上下文
 * @returns LanguageModel
 */
export function resolveModelForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): LanguageModel {
  const { model: modelConfig } = definition;
  const { provider, parentModel, modelAliases } = context;

  // 未指定或 inherit - 使用父模型
  if (!modelConfig || modelConfig === 'inherit') {
    return parentModel;
  }

  // 如果是 LanguageModel 对象
  if (typeof modelConfig === 'object' && 'modelId' in modelConfig) {
    return modelConfig;
  }

  // fast / smart / default 或具体模型名 - 需要 provider
  if ((modelConfig === 'fast' || modelConfig === 'smart' || typeof modelConfig === 'string') && !provider) {
    logger.warn('ModelResolver', 'Provider is required for model shortcuts. Falling back to parent model.');
    return parentModel;
  }

  if (typeof modelConfig === 'string' && provider) {
    return provider(resolveModelAlias(modelConfig, modelAliases));
  }

  // 默认使用父模型
  return parentModel;
}
