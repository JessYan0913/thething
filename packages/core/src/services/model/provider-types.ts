// ============================================================
// Model Provider Types
// ============================================================

import type { LanguageModel } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'

/**
 * Model Provider Configuration
 */
export interface ModelProviderConfig {
  /** API Key */
  apiKey: string;
  /** Base URL */
  baseURL: string;
  /** Default model name */
  modelName?: string;
  /** Include usage information in responses */
  includeUsage?: boolean;
  /** Enable thinking/reasoning mode for models that support it (e.g., qwen3, gpt-5) */
  enableThinking?: boolean;
}

/**
 * Model Provider function type
 * Returns a LanguageModel instance for a given model name
 */
export type ModelProviderFn = (modelName: string) => LanguageModelV3;