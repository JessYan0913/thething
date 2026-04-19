// ============================================================
// Model Provider Configuration
// ============================================================
// Extracts model provider creation from environment variables.
// The core package should not hardcode provider config — it receives it from
// the caller (Next.js API route, CLI, etc.).

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";

export interface ModelProviderConfig {
  apiKey: string;
  baseURL: string;
  modelName?: string;
  includeUsage?: boolean;
  /** Enable thinking/reasoning mode for models that support it (e.g., qwen3) */
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
 * For qwen3 models, enables thinking mode if requested.
 */
export function createLanguageModel(config: ModelProviderConfig): LanguageModelV3 {
  const provider = createModelProvider(config);
  const modelName = config.modelName || "qwen-max";

  // For qwen3 models, we can enable thinking via provider options
  if (config.enableThinking && modelName.includes('qwen3')) {
    return provider(modelName, {
      // Enable thinking mode for qwen3 - DashScope uses this format
      reasoningEffort: 'high',
    });
  }

  return provider(modelName);
}

/**
 * Default provider config from environment variables.
 * Used as fallback when no explicit config is provided.
 */
export function getDefaultProviderConfig(): ModelProviderConfig {
  return {
    apiKey: process.env.DASHSCOPE_API_KEY!,
    baseURL: process.env.DASHSCOPE_BASE_URL!,
    modelName: process.env.DASHSCOPE_MODEL || "qwen-max",
    includeUsage: true,
    enableThinking: process.env.DASHSCOPE_ENABLE_THINKING === 'true',
  };
}

/**
 * Convenience: get a default provider singleton.
 */
let defaultProvider: ModelProvider | null = null;

export function getDefaultModelProvider(): ModelProvider {
  if (!defaultProvider) {
    defaultProvider = createModelProvider(getDefaultProviderConfig());
  }
  return defaultProvider;
}