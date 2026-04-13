import type { AgentDefinition, AgentExecutionContext, LanguageModel } from '../core/types';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
  includeUsage: true,
});

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
    return dashscope(MODEL_MAPPING.fast);
  }
  if (modelConfig === 'smart') {
    return dashscope(MODEL_MAPPING.smart);
  }

  if (typeof modelConfig === 'string') {
    return dashscope(modelConfig);
  }

  if (typeof modelConfig === 'object' && 'modelId' in modelConfig) {
    return modelConfig;
  }

  return context.parentModel;
}
