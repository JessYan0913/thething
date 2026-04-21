import type { AgentDefinition, AgentExecutionContext, LanguageModel } from '../core/types';

// 从统一配置模块导入常量
import { MODEL_MAPPING } from '../../config/defaults';

// 重新导出供其他模块使用
export { MODEL_MAPPING };

/**
 * 解析 Agent 使用的模型
 *
 * @param definition Agent 定义
 * @param context 执行上下文
 */
export function resolveModelForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): LanguageModel {
  const { model: modelConfig } = definition;
  const { provider, parentModel } = context;

  if (!modelConfig || modelConfig === 'inherit') {
    return parentModel;
  }

  // 如果指定了 fast/smart 或具体模型名，需要 provider
  if ((modelConfig === 'fast' || modelConfig === 'smart' || typeof modelConfig === 'string') && !provider) {
    console.warn('[ModelResolver] Provider is required for model shortcuts. Falling back to parent model.');
    return parentModel;
  }

  if (modelConfig === 'fast' && provider) {
    return provider(MODEL_MAPPING.fast);
  }
  if (modelConfig === 'smart' && provider) {
    return provider(MODEL_MAPPING.smart);
  }

  if (typeof modelConfig === 'string' && provider) {
    return provider(modelConfig);
  }

  if (typeof modelConfig === 'object' && 'modelId' in modelConfig) {
    return modelConfig;
  }

  return parentModel;
}