// ============================================================
// Workflow Orchestrator
// ============================================================
// Runs the slice loop: execute agent in bounded slices,
// persist state between slices, resume on timeout/restart.

import type { UIMessage, UIMessageChunk } from 'ai';
import type {
  DurableAgentState,
  AgentStateStore,
  StreamFactory,
} from '@the-thing/workflow-harness';
import { runSlice, createFreshState, isResumable } from '@the-thing/workflow-harness';

export interface WorkflowOptions {
  /** Stream factory (wraps createAgentUIStream) */
  createStream: StreamFactory;
  /** Conversation ID */
  conversationId: string;
  /** Original UI messages for this conversation turn */
  messages: UIMessage[];
  /** State store for persistence */
  stateStore: AgentStateStore;
  /** Slice timeout in ms. Default: 300000 (5 min) */
  sliceTimeoutMs?: number;
  /** Writable stream for real-time chunk output */
  writable?: WritableStream<UIMessageChunk>;
  /** External abort signal */
  abortSignal?: AbortSignal;
  /** Called for each chunk */
  onChunk?: (chunk: UIMessageChunk) => void;
}

/**
 * Run a workflow: execute the agent in slices with durable state persistence.
 *
 * Flow:
 * 1. Load or create state
 * 2. While state is resumable (running/timed_out):
 *    a. Run a slice
 *    b. Persist state
 * 3. Return final state
 */
export async function runWorkflow(options: WorkflowOptions): Promise<DurableAgentState> {
  const {
    createStream,
    conversationId,
    messages,
    stateStore,
    sliceTimeoutMs,
    writable,
    abortSignal,
    onChunk,
  } = options;

  // Load existing state or create fresh
  let state = stateStore.getState(conversationId);
  if (!state || !isResumable(state.status)) {
    state = createFreshState(conversationId);
    stateStore.saveState(state);
  }

  // Slice loop
  while (isResumable(state.status)) {
    // Check abort before starting a new slice
    if (abortSignal?.aborted) {
      state.status = 'failed';
      state.error = 'Aborted by user';
      state.updatedAt = new Date().toISOString();
      stateStore.saveState(state);
      break;
    }

    // Determine messages for this slice
    // If resuming from timed_out, use accumulated messages from last checkpoint
    const sliceMessages = state.status === 'timed_out' && state.accumulatedMessages.length > 0
      ? state.accumulatedMessages
      : messages;

    const result = await runSlice({
      createStream,
      state,
      messages: sliceMessages,
      sliceTimeoutMs,
      writable,
      abortSignal,
      onChunk,
      onStepComplete: (updatedState) => {
        // Persist state at each step boundary
        stateStore.saveState(updatedState);
      },
    });

    state = result.state;
    stateStore.saveState(state);
  }

  return state;
}
