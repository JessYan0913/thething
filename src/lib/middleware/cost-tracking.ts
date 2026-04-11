import type {
  LanguageModelV3FinishReason,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import type { CostTracker } from '../session-state/cost';

function extractTokenCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'total' in value) {
    return (value as { total?: number }).total ?? 0;
  }
  return 0;
}

function extractCacheRead(value: unknown): number {
  if (value && typeof value === 'object' && 'cacheRead' in value) {
    return (value as { cacheRead?: number }).cacheRead ?? 0;
  }
  return 0;
}

export function costTrackingMiddleware(costTracker: CostTracker): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();

      if (result.usage) {
        const inputTokens = extractTokenCount(result.usage.inputTokens);
        const outputTokens = extractTokenCount(result.usage.outputTokens);
        const cachedTokens = extractCacheRead(result.usage.inputTokens);

        costTracker.accumulateFromUsage(inputTokens, outputTokens, cachedTokens);
      }

      return result;
    },

    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();

      let finalUsage: LanguageModelV3Usage | undefined;
      let finalFinishReason: LanguageModelV3FinishReason | undefined;

      const transformStream = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(chunk, controller) {
          switch (chunk.type) {
            case 'finish':
              finalUsage = chunk.usage;
              finalFinishReason = chunk.finishReason;
              break;
          }
          controller.enqueue(chunk);
        },

        flush() {
          if (finalUsage) {
            const inputTokens = extractTokenCount(finalUsage.inputTokens);
            const outputTokens = extractTokenCount(finalUsage.outputTokens);
            const cachedTokens = extractCacheRead(finalUsage.inputTokens);

            costTracker.accumulateFromUsage(inputTokens, outputTokens, cachedTokens);
          }
        },
      });

      return {
        stream: stream.pipeThrough(transformStream),
        ...rest,
      };
    },
  };
}