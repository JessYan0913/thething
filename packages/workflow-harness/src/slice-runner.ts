// ============================================================
// Slice Runner
// ============================================================
// Executes a single "slice" of an agent run with wall-clock timeout.
// Modeled after @ai-sdk/workflow-harness runHarnessAgentSlice().
//
// Flow:
// 1. Create a stream via the factory (which wraps createAgentUIStream)
// 2. Consume chunks with a timeout race
// 3. On each step boundary (via onStep callback), checkpoint state
// 4. On timeout: abort, save stream context, return timed_out
// 5. On completion: return finished
// 6. On abort: return failed

import type { UIMessage, UIMessageChunk } from 'ai';
import type { SliceOptions, SliceResult, DurableAgentState } from './types';
import { trackChunk, closeOpenParts, serialize } from './stream-context';

const DEFAULT_SLICE_TIMEOUT_MS = 300_000; // 5 minutes

export async function runSlice(options: SliceOptions): Promise<SliceResult> {
  const {
    createStream,
    state,
    messages,
    sliceTimeoutMs = DEFAULT_SLICE_TIMEOUT_MS,
    writable,
    abortSignal,
    onChunk,
    onStepComplete,
  } = options;

  const chunks: UIMessageChunk[] = [];
  const streamContext = state.streamContext ? { ...state.streamContext } : {};
  let lastCheckpointMessages: UIMessage[] | null = null;
  let completedNormally = false;
  let timedOut = false;
  let aborted = false;

  // Create per-slice abort controller (linked to external signal)
  const sliceAbort = new AbortController();
  const onExternalAbort = () => sliceAbort.abort();
  abortSignal?.addEventListener('abort', onExternalAbort);

  // Set up wall-clock timeout
  const timeoutId = setTimeout(() => {
    timedOut = true;
    sliceAbort.abort();
  }, sliceTimeoutMs);

  // Step boundary callback — called by createAgentUIStream at end of each step
  const onStep = (event: { messages: UIMessage[] }) => {
    lastCheckpointMessages = event.messages;
    // Update state with checkpoint
    state.accumulatedMessages = event.messages;
    state.stepCount++;
    state.updatedAt = new Date().toISOString();
    if (onStepComplete) {
      onStepComplete({ ...state });
    }
  };

  let writer: WritableStreamDefaultWriter<UIMessageChunk> | null = null;

  try {
    // Create the stream via factory
    const stream = await createStream({
      messages,
      abortSignal: sliceAbort.signal,
      onStep,
    });

    // Get writer for writable output
    if (writable) {
      writer = writable.getWriter();
    }

    // Consume the stream
    for await (const chunk of stream) {
      chunks.push(chunk);
      trackChunk(chunk, streamContext);

      // Forward to writable
      if (writer) {
        try {
          await writer.write(chunk);
        } catch {
          // writable closed or errored, stop forwarding
        }
      }

      // Notify chunk callback
      onChunk?.(chunk);
    }

    completedNormally = true;
  } catch (err) {
    if (timedOut) {
      // Expected: timeout caused abort
    } else if (abortSignal?.aborted) {
      aborted = true;
    } else {
      // Unexpected error
      state.status = 'failed';
      state.error = err instanceof Error ? err.message : String(err);
      state.updatedAt = new Date().toISOString();
      return { state, chunks };
    }
  } finally {
    clearTimeout(timeoutId);
    abortSignal?.removeEventListener('abort', onExternalAbort);

    if (writer) {
      try {
        await writer.close();
      } catch {
        // already closed
      }
    }
  }

  // Determine final state
  if (completedNormally) {
    state.status = 'finished';
    state.streamContext = undefined;
  } else if (timedOut) {
    // Close any open parts for clean state
    const closingChunks = closeOpenParts(streamContext);
    for (const chunk of closingChunks) {
      chunks.push(chunk);
      if (writer) {
        try { await writer.write(chunk); } catch { /* ignore */ }
      }
      onChunk?.(chunk);
    }

    state.status = 'timed_out';
    state.streamContext = Object.keys(streamContext).length > 0 ? streamContext : undefined;
  } else if (aborted) {
    state.status = 'failed';
    state.error = 'Aborted by user';
    state.streamContext = undefined;
  }

  state.updatedAt = new Date().toISOString();
  return { state, chunks };
}
