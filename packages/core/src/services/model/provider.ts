// ============================================================
// Model Provider - OpenAI Compatible Provider Factory
// ============================================================
// Core package 只提供配置类型和创建函数，不读取环境变量。
// 应用层（CLI/Server）负责组装配置并传入。

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel, defaultSettingsMiddleware } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ModelProviderConfig, ModelProviderFn } from './provider-types';


export type { ModelProviderConfig, ModelProviderFn };

/**
 * Create an OpenAI-compatible model provider.
 * This is the primary way to create providers for the core engine.
 */
export function createModelProvider(config: ModelProviderConfig): ModelProviderFn {
  return createOpenAICompatible({
    name: "openai-compatible",
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    includeUsage: config.includeUsage ?? true,
  });
}

/**
 * Get a LanguageModel instance from the provider config.
 * Uses defaultSettingsMiddleware to configure providerOptions for thinking mode.
 *
 * @throws 如果 modelName 未提供
 */
export function createLanguageModel(config: ModelProviderConfig): LanguageModelV3 {
  const provider = createModelProvider(config);

  if (!config.modelName) {
    throw new Error('modelName is required but was not provided');
  }

  // Base model from provider
  const baseModel = provider(config.modelName);

  // If thinking mode is enabled, wrap with defaultSettingsMiddleware
  if (config.enableThinking) {
    return wrapLanguageModel({
      model: baseModel,
      middleware: defaultSettingsMiddleware({
        settings: {
          providerOptions: {
            openai: {
              reasoningEffort: 'high',
            },
          },
        },
      }),
    });
  }

  return baseModel;
}