import type { AgentDefinition, AgentExecutionContext, LanguageModel } from '../core/types';
import { getDefaultModelProvider } from '../../model-provider';

const provider = getDefaultModelProvider();

export const MODEL_MAPPING = {
  fast: 'qwen-turbo',
  smart: 'qwen-max',
  default: 'qwen-plus',
};

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