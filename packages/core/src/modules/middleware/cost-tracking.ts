import type {
  LanguageModelV3FinishReason,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import type { CostTracker } from '../session/cost';

function extractOutputTokens(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'total' in value) {
    return (value as { total?: number }).total ?? 0;
  }
  return 0;
}

// AI SDK V3 spec: inputTokens is { total, noCache, cacheRead, cacheWrite }.
// CostTracker 期望 (inputTokens, cachedReadTokens) 满足 inputTokens + cachedReadTokens
// = 总输入，否则 cost 计算会双计、缓存命中率会失真。优先用 noCache；
// 旧 provider 只给 total 时回退 total - cacheRead；都没有则视为 0。
function extractInputUsage(value: unknown): { inputTokens: number; cachedReadTokens: number } {
  if (!value || typeof value !== 'object') {
    return { inputTokens: typeof value === 'number' ? value : 0, cachedReadTokens: 0 };
  }
  const obj = value as { noCache?: number; total?: number; cacheRead?: number };
  const cacheRead = obj.cacheRead ?? 0;
  let input: number;
  if (typeof obj.noCache === 'number') {
    input = obj.noCache;
  } else if (typeof obj.total === 'number') {
    input = Math.max(0, obj.total - cacheRead);
  } else {
    input = 0;
  }
  return { inputTokens: input, cachedReadTokens: cacheRead };
}

export function costTrackingMiddleware(costTracker: CostTracker): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();

      if (result.usage) {
        const { inputTokens, cachedReadTokens } = extractInputUsage(result.usage.inputTokens);
        const outputTokens = extractOutputTokens(result.usage.outputTokens);
        costTracker.accumulateFromUsage(inputTokens, outputTokens, cachedReadTokens);
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
            const { inputTokens, cachedReadTokens } = extractInputUsage(finalUsage.inputTokens);
            const outputTokens = extractOutputTokens(finalUsage.outputTokens);
            costTracker.accumulateFromUsage(inputTokens, outputTokens, cachedReadTokens);
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
