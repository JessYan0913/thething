import type {
  LanguageModelV3FinishReason,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

export interface TelemetryState {
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalDurationMs: number;
  errorCount: number;
  lastModelId: string;
  lastDurationMs: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastCachedTokens: number;
  lastFinishReason: string;
}

function createState(): TelemetryState {
  return {
    callCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalDurationMs: 0,
    errorCount: 0,
    lastModelId: '',
    lastDurationMs: 0,
    lastInputTokens: 0,
    lastOutputTokens: 0,
    lastCachedTokens: 0,
    lastFinishReason: '',
  };
}

function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: Record<string, unknown>) {
  // Only log when DEBUG environment variable is set
  if (!process.env.DEBUG && level !== 'error') {
    return;
  }
  const timestamp = new Date().toISOString();
  const prefix = `[TELE:${level.toUpperCase()}]`;
  const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
  const logger: Record<string, typeof console.log> = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  logger[level](`${prefix} ${timestamp} | ${message}${metaStr}`);
}

function extractModelId(params: Record<string, unknown>): string {
  const providerMetadata = params.providerMetadata as Record<string, unknown> | undefined;
  return (
    (providerMetadata?.model as string | undefined) ?? (providerMetadata?.modelId as string | undefined) ?? 'unknown'
  );
}

function extractTokenCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'total' in value) {
    return (value as { total?: number }).total ?? 0;
  }
  return 0;
}

function accumulateUsage(state: TelemetryState, usage: LanguageModelV3Usage | undefined): void {
  if (!usage) return;
  const inputTokens = extractTokenCount(usage.inputTokens);
  const outputTokens = extractTokenCount(usage.outputTokens);
  const cachedTokens =
    typeof usage.inputTokens === 'object' && usage.inputTokens !== null
      ? ((usage.inputTokens as { cacheRead?: number }).cacheRead ?? 0)
      : 0;

  state.totalInputTokens += inputTokens;
  state.totalOutputTokens += outputTokens;
  state.totalCachedTokens += cachedTokens;

  state.lastInputTokens = inputTokens;
  state.lastOutputTokens = outputTokens;
  state.lastCachedTokens = cachedTokens;
}

export function telemetryMiddleware(): LanguageModelV3Middleware {
  const state = createState();

  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate, params }) => {
      const startTime = Date.now();
      const modelId = extractModelId(params);

      log('info', 'doGenerate start', { model: modelId });
      state.callCount++;

      try {
        const result = await doGenerate();
        const duration = Date.now() - startTime;

        const textContent = result.content.filter((c) => c.type === 'text') as Array<{ type: 'text'; text: string }>;
        const outputLength = textContent.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);

        accumulateUsage(state, result.usage);
        state.totalDurationMs += duration;

        state.lastModelId = modelId;
        state.lastDurationMs = duration;
        state.lastFinishReason = String(result.finishReason ?? 'unknown');

        log('info', 'doGenerate ok', {
          model: modelId,
          duration: `${duration}ms`,
          outputChars: outputLength,
          inputTokens: state.lastInputTokens,
          outputTokens: state.lastOutputTokens,
          cachedTokens: state.lastCachedTokens,
          finishReason: result.finishReason,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        state.errorCount++;
        state.lastDurationMs = duration;

        log('error', 'doGenerate error', {
          model: modelId,
          duration: `${duration}ms`,
          error: (error as Error).message,
        });

        throw error;
      }
    },

    wrapStream: async ({ doStream, params }) => {
      const startTime = Date.now();
      const modelId = extractModelId(params);

      log('info', 'doStream start', { model: modelId });
      state.callCount++;

      const { stream, ...rest } = await doStream();

      let generatedText = '';
      let finalUsage: LanguageModelV3Usage | undefined;
      let finalFinishReason: LanguageModelV3FinishReason | undefined;
      const toolCalls: Array<{ id?: string; name?: string }> = [];

      const transformStream = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(chunk, controller) {
          switch (chunk.type) {
            case 'text-delta':
              generatedText += chunk.delta;
              break;
            case 'tool-call':
              // 调试：记录tool call信息
              const tc = chunk as unknown as { toolCallId?: string; toolName?: string };
              toolCalls.push({ id: tc.toolCallId, name: tc.toolName });
              log('debug', 'tool-call chunk received', {
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                inputPreview: JSON.stringify(chunk).slice(0, 200)
              });
              break;
            case 'tool-input-start':
              // 调试：记录tool input开始
              const tis = chunk as unknown as { id?: string; toolName?: string };
              log('debug', 'tool-input-start', { id: tis.id, toolName: tis.toolName });
              break;
            case 'finish':
              finalUsage = chunk.usage;
              finalFinishReason = chunk.finishReason;
              break;
          }
          controller.enqueue(chunk);
        },

        flush() {
          const duration = Date.now() - startTime;

          accumulateUsage(state, finalUsage);
          state.totalDurationMs += duration;

          state.lastModelId = modelId;
          state.lastDurationMs = duration;
          state.lastFinishReason = (finalFinishReason ?? 'unknown') as string;

          log('info', 'doStream ok', {
            model: modelId,
            duration: `${duration}ms`,
            outputChars: generatedText.length,
            inputTokens: state.lastInputTokens,
            outputTokens: state.lastOutputTokens,
            cachedTokens: state.lastCachedTokens,
            finishReason: finalFinishReason,
            toolCallsCount: toolCalls.length,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        },
      });

      return {
        stream: stream.pipeThrough(transformStream),
        ...rest,
      };
    },
  };
}

export function getTelemetryState(state: TelemetryState): Readonly<TelemetryState> {
  return { ...state };
}

export function resetTelemetryState(state: TelemetryState): void {
  state.callCount = 0;
  state.totalInputTokens = 0;
  state.totalOutputTokens = 0;
  state.totalCachedTokens = 0;
  state.totalDurationMs = 0;
  state.errorCount = 0;
  state.lastModelId = '';
  state.lastDurationMs = 0;
  state.lastInputTokens = 0;
  state.lastOutputTokens = 0;
  state.lastCachedTokens = 0;
  state.lastFinishReason = '';
}