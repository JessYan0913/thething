// ============================================================
// Model Provider Configuration
// ============================================================
// Core package 只提供配置类型和创建函数，不读取环境变量。
// 应用层（CLI/Server）负责组装配置并传入。

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel, defaultSettingsMiddleware } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";

export interface ModelProviderConfig {
  apiKey: string;
  baseURL: string;
  modelName?: string;
  includeUsage?: boolean;
  /** Enable thinking/reasoning mode for models that support it (e.g., qwen3, gpt-5) */
  enableThinking?: boolean;
}

// The provider is callable, returns LanguageModelV3
type ModelProvider = (modelName: string) => LanguageModelV3;

/**
 * Create an OpenAI-compatible model provider.
 * This is the primary way to create providers for the core engine.
 */
export function createModelProvider(config: ModelProviderConfig): ModelProvider {
  return createOpenAICompatible({
    name: "dashscope",
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    includeUsage: config.includeUsage ?? true,
  });
}

/**
 * Get a LanguageModel instance from the provider config.
 * Uses defaultSettingsMiddleware to configure providerOptions for thinking mode.
 */
export function createLanguageModel(config: ModelProviderConfig): LanguageModelV3 {
  const provider = createModelProvider(config);
  const modelName = config.modelName || "qwen-max";

  // Base model from provider
  const baseModel = provider(modelName);

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