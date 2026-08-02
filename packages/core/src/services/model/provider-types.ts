// ============================================================
// Model Provider Types
// ============================================================

import type { LanguageModel } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ModelEntry } from '../config/global-config'

/**
 * Model Provider Configuration
 *
 * apiKey/baseURL 为默认凭据;可选 models 列表提供按模型名分发的
 * 多供应商凭据(见 provider.ts createModelRegistry)。
 */
export interface ModelProviderConfig {
  /** API Key(默认凭据) */
  apiKey: string;
  /** Base URL(默认凭据) */
  baseURL: string;
  /** Default model name */
  modelName?: string;
  /** 多供应商模型列表:命中条目时用条目自带凭据创建 provider */
  models?: ModelEntry[];
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