import type { LanguageModelV3Content, LanguageModelV3Middleware, LanguageModelV3StreamPart } from '@ai-sdk/provider';

const DEFAULT_SENSITIVE_KEYWORDS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  /\b\d{16}\b/,
];

export function guardrailsMiddleware(options?: { keywords?: RegExp[] }): LanguageModelV3Middleware {
  const keywords = options?.keywords ?? DEFAULT_SENSITIVE_KEYWORDS;

  function createSanitizer() {
    const freshPatterns = keywords.map((r) => new RegExp(r.source, r.flags.replace('g', '') + 'g'));
    return (text: string): string => {
      let sanitized = text;
      for (const pattern of freshPatterns) {
        pattern.lastIndex = 0;
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
      return sanitized;
    };
  }

  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate }) => {
      const sanitizeText = createSanitizer();
      const result = await doGenerate();

      const sanitizedContent: LanguageModelV3Content[] = result.content.map((part) => {
        if (part.type === 'text') {
          return { ...part, text: sanitizeText(part.text) };
        }
        if (part.type === 'reasoning') {
          return { ...part, text: sanitizeText(part.text) };
        }
        return part;
      });

      return {
        ...result,
        content: sanitizedContent,
      };
    },

    wrapStream: async ({ doStream }) => {
      const sanitizeText = createSanitizer();
      const { stream, ...rest } = await doStream();

      const transformStream = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(chunk, controller) {
          if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
            const sanitizedDelta = sanitizeText(chunk.delta);
            controller.enqueue({ ...chunk, delta: sanitizedDelta });
          } else {
            controller.enqueue(chunk);
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