// @the-thing/workflow-harness — Slice execution engine
// Pure logic, no storage dependencies.

export { runSlice } from './slice-runner';
export {
  trackChunk,
  closeOpenParts,
  writePrelude,
  serialize as serializeStreamContext,
  deserialize as deserializeStreamContext,
} from './stream-context';
export type {
  DurableAgentState,
  DurableAgentStatus,
  SerializedChunk,
  StreamContext,
  SliceOptions,
  SliceResult,
  StreamFactory,
  AgentStateStore,
} from './types';
export { createFreshState, isResumable } from './types';
