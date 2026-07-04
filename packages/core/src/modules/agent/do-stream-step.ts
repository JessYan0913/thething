// ============================================================
// doStreamStep — Single LLM streaming call
// ============================================================
// Wraps experimental_streamLanguageModelCall for a single step.
// Accepts LanguageModelV4Prompt (the low-level format).
// Modeled after @ai-sdk/workflow/do-stream-step.ts

import { experimental_streamLanguageModelCall } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

export interface DoStreamStepOptions {
  model: LanguageModel;
  messages: LanguageModelV4Prompt;
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  instructions?: string;
}

export interface DoStreamStepResult {
  stream: AsyncIterable<{ type: string; [key: string]: unknown }>;
}

/**
 * Execute a single LLM streaming call.
 * Accepts LanguageModelV4Prompt (not ModelMessage[]).
 */
export async function doStreamStep(
  options: DoStreamStepOptions,
): Promise<DoStreamStepResult> {
  const { model, messages, tools, abortSignal, instructions } = options;

  const result = await experimental_streamLanguageModelCall({
    model,
    messages,
    tools,
    abortSignal,
    instructions,
    _internal: {
      generateId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  });

  return {
    stream: result.stream as AsyncIterable<{ type: string; [key: string]: unknown }>,
  };
}
