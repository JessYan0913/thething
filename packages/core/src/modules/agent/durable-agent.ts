// ============================================================
// DurableAgent — Generator-based agent with step-level control
// ============================================================
// Drop-in replacement for ToolLoopAgent. Compatible with
// createAgentUIStream: stream() returns { stream: ReadableStream<TextStreamPart> }.
//
// Architecture (modeled after @ai-sdk/workflow WorkflowAgent):
//   stream() → stepLoop() generator → doStreamStep() → model.doStream()
//                 ↓ yield TextStreamPart chunks (forwarded from LLM)
//            execute tools between steps
//                 ↓ yield tool-result chunks
//            next step
//
// Key: conversationPrompt uses LanguageModelV4Prompt format,
// converted via standardizePrompt + convertToLanguageModelPrompt.

import type {
  LanguageModel,
  ModelMessage,
  ToolSet,
  TextStreamPart,
} from 'ai';
import {
  standardizePrompt,
  convertToLanguageModelPrompt,
} from 'ai/internal';
import type {
  LanguageModelV4Prompt,
  LanguageModelV4ToolResultPart,
} from '@ai-sdk/provider';
import { doStreamStep } from './do-stream-step';

// ============================================================
// Types
// ============================================================

export interface DurableAgentOptions {
  model: LanguageModel;
  instructions?: string;
  tools: ToolSet;
  runtimeContext?: unknown;
  /** Called at each step boundary with step info */
  onStepEnd?: (event: { stepNumber: number; toolCalls: Array<{ toolName: string }> }) => void;
  /** Called when a tool execution finishes */
  onToolExecutionEnd?: (event: { toolCall: { toolName: string } }) => void;
}

export interface DurableAgentStreamResult {
  stream: ReadableStream<TextStreamPart<ToolSet>>;
}

// ============================================================
// DurableAgent
// ============================================================

export class DurableAgent {
  readonly tools: ToolSet;
  private model: LanguageModel;
  private instructions: string;
  private onStepEnd?: DurableAgentOptions['onStepEnd'];
  private onToolExecutionEnd?: DurableAgentOptions['onToolExecutionEnd'];

  constructor(options: DurableAgentOptions) {
    this.model = options.model;
    this.instructions = options.instructions || '';
    this.tools = options.tools;
    this.onStepEnd = options.onStepEnd;
    this.onToolExecutionEnd = options.onToolExecutionEnd;
  }

  /**
   * Convert ModelMessage[] to LanguageModelV4Prompt.
   * Uses the same pipeline as WorkflowAgent: standardizePrompt → convertToLanguageModelPrompt.
   */
  private async toLanguageModelPrompt(messages: ModelMessage[]): Promise<LanguageModelV4Prompt> {
    const standardized = await standardizePrompt({
      messages,
      instructions: this.instructions,
    });
    return convertToLanguageModelPrompt({
      prompt: standardized,
      supportedUrls: {},
      download: undefined,
    });
  }

  /**
   * Async generator that runs the multi-step agent loop.
   * Yields TextStreamPart chunks from the LLM + tool results.
   */
  private async *stepLoop(
    prompt: ModelMessage[],
    abortSignal?: AbortSignal,
    onStepEnd?: DurableAgentOptions['onStepEnd'],
  ): AsyncGenerator<TextStreamPart<ToolSet>> {
    // Convert initial messages to LanguageModelV4Prompt
    let conversationPrompt: LanguageModelV4Prompt = await this.toLanguageModelPrompt(prompt);
    let stepNumber = 0;
    let done = false;
    let totalChunks = 0;

    console.log(`[DurableAgent] stepLoop started, ${conversationPrompt.length} messages`);

    while (!done) {
      if (abortSignal?.aborted) {
        console.log('[DurableAgent] abortSignal detected, breaking');
        break;
      }

      // Single LLM streaming call
      console.log(`[DurableAgent] calling doStreamStep, step ${stepNumber}`);
      let result;
      try {
        result = await doStreamStep({
          model: this.model,
          messages: conversationPrompt,
          tools: this.tools,
          abortSignal,
          instructions: this.instructions,
        });
        console.log('[DurableAgent] doStreamStep returned, stream:', typeof result.stream);
      } catch (err) {
        console.error('[DurableAgent] doStreamStep error:', err);
        throw err;
      }

      // Forward all chunks from the LLM stream + collect tool calls
      const toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
      let hasToolCalls = false;
      let stepChunks = 0;
      let textContent = '';

      for await (const chunk of result.stream) {
        // Skip internal metadata chunks
        if (chunk.type === 'model-call-start' ||
            chunk.type === 'model-call-end' ||
            chunk.type === 'model-call-response-metadata' ||
            chunk.type === 'stream-start') {
          continue;
        }

        stepChunks++;
        totalChunks++;
        // Forward to caller (for toUIMessageStream conversion)
        yield chunk as TextStreamPart<ToolSet>;

        if (chunk.type === 'tool-call') {
          const tc = chunk as unknown as { toolCallId: string; toolName: string; input: unknown };
          toolCalls.push(tc);
          hasToolCalls = true;
        } else if (chunk.type === 'text-delta') {
          textContent += (chunk as unknown as { delta: string }).delta;
        }
      }
      console.log(`[DurableAgent] step ${stepNumber} stream done, ${stepChunks} chunks, hasToolCalls: ${hasToolCalls}`);

      if (hasToolCalls && toolCalls.length > 0) {
        // Add assistant message with tool calls to conversation prompt
        conversationPrompt = [
          ...conversationPrompt,
          {
            role: 'assistant' as const,
            content: toolCalls.map(tc => ({
              type: 'tool-call' as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.input,
            })),
          },
        ];

        // Execute tools
        const toolResults: LanguageModelV4ToolResultPart[] = [];

        for (const tc of toolCalls) {
          if (abortSignal?.aborted) break;

          const toolDef = this.tools[tc.toolName];
          if (toolDef && 'execute' in toolDef && toolDef.execute) {
            try {
              const output = await (toolDef.execute as Function)(tc.input, {
                toolCallId: tc.toolCallId,
                abortSignal,
                messages: conversationPrompt,
              });
              toolResults.push({
                type: 'tool-result',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: 'json', value: output },
              });

              // Yield tool result as TextStreamPart
              yield {
                type: 'tool-result',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.input,
                output,
              } as unknown as TextStreamPart<ToolSet>;
            } catch (err) {
              const errorText = err instanceof Error ? err.message : String(err);
              toolResults.push({
                type: 'tool-result',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: 'text', value: `Error: ${errorText}` },
              });

              yield {
                type: 'tool-error',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.input,
                error: errorText,
              } as unknown as TextStreamPart<ToolSet>;
            }
          } else {
            toolResults.push({
              type: 'tool-result',
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              output: { type: 'text', value: 'Tool not found' },
            });
          }

          this.onToolExecutionEnd?.({ toolCall: { toolName: tc.toolName } });
        }

        // Add tool results to conversation prompt
        conversationPrompt = [
          ...conversationPrompt,
          {
            role: 'tool' as const,
            content: toolResults,
          },
        ];

        // Step boundary — notify caller
        stepNumber++;
        onStepEnd?.({
          stepNumber,
          toolCalls: toolCalls.map(tc => ({ toolName: tc.toolName })),
        });
      } else {
        // No tool calls — LLM is done
        console.log(`[DurableAgent] step ${stepNumber} no tool calls, done`);
        done = true;
      }
    }
    console.log(`[DurableAgent] stepLoop finished, totalChunks: ${totalChunks}`);
  }

  /**
   * Stream the agent execution.
   * Compatible with createAgentUIStream: returns { stream: ReadableStream<TextStreamPart> }.
   */
  async stream(options: {
    prompt: ModelMessage[];
    abortSignal?: AbortSignal;
    onStepEnd?: DurableAgentOptions['onStepEnd'];
    [key: string]: unknown;
  }): Promise<DurableAgentStreamResult> {
    const { prompt, abortSignal, onStepEnd } = options;

    console.log(`[DurableAgent] stream() called with ${prompt?.length ?? 0} messages`);

    const generator = this.stepLoop(prompt, abortSignal, onStepEnd ?? this.onStepEnd);

    // Wrap generator in ReadableStream for toUIMessageStream compatibility
    const stream = new ReadableStream<TextStreamPart<ToolSet>>({
      async start(controller) {
        try {
          for await (const chunk of generator) {
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return { stream };
  }
}
