import type { AgentDefinition, AgentExecutionContext, LanguageModel } from '../core/types';
import { getDefaultModelProvider } from '../../model-provider';

// 从统一配置模块导入常量
import { MODEL_MAPPING } from '../../config/defaults';

// 重新导出供其他模块使用
export { MODEL_MAPPING };

const provider = getDefaultModelProvider();

export function resolveModelForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): LanguageModel {
  const { model: modelConfig } = definition;

  if (!modelConfig || modelConfig === 'inherit') {
    return context.parentModel;
  }

  if (modelConfig === 'fast') {
    return provider(MODEL_MAPPING.fast);
  }
  if (modelConfig === 'smart') {
    return provider(MODEL_MAPPING.smart);
  }

  if (typeof modelConfig === 'string') {
    return provider(modelConfig);
  }

  if (typeof modelConfig === 'object' && 'modelId' in modelConfig) {
    return modelConfig;
  }

  return context.parentModel;
}