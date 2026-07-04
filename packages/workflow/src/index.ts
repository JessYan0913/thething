// @the-thing/workflow — SQLite-backed workflow orchestration

export { runWorkflow } from './orchestrator';
export type { WorkflowOptions } from './orchestrator';
export { SQLiteAgentStateStore } from './sqlite-store';

// Re-export key types from workflow-harness
export type {
  DurableAgentState,
  DurableAgentStatus,
  AgentStateStore,
  StreamFactory,
  StreamContext,
} from '@the-thing/workflow-harness';
export { createFreshState, isResumable } from '@the-thing/workflow-harness';
