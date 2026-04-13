import type { SubAgentStreamWriter } from '../core/types';

export type AgentEventType =
  | 'data-sub-open'
  | 'data-sub-text-delta'
  | 'data-sub-tool-call'
  | 'data-sub-tool-result'
  | 'data-sub-done'
  | 'data-sub-error'
  | 'data-sub-progress';

export interface AgentEvent {
  type: AgentEventType;
  id: string;
  data: Record<string, unknown>;
}

export class EventBroadcaster {
  private writer: SubAgentStreamWriter | null;

  constructor(writer: SubAgentStreamWriter | null) {
    this.writer = writer;
  }

  broadcast(type: AgentEventType, id: string, data: Record<string, unknown>): void {
    this.writer?.write({ type, id, data });
  }

  broadcastOpen(id: string, agentType: string, task: string): void {
    this.broadcast('data-sub-open', id, { agentType, task });
  }

  broadcastTextDelta(id: string, text: string, accumulated: string): void {
    this.broadcast('data-sub-text-delta', id, { text, accumulated });
  }

  broadcastToolCall(id: string, name: string, input: Record<string, unknown>): void {
    this.broadcast('data-sub-tool-call', id, { name, input });
  }

  broadcastToolResult(id: string, name: string, result: string): void {
    this.broadcast('data-sub-tool-result', id, { name, result });
  }

  broadcastDone(
    id: string,
    data: {
      success: boolean;
      durationMs: number;
      agentType?: string;
      stepsExecuted?: number;
      toolsUsed?: string[];
      tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      error?: string;
      status?: string;
    }
  ): void {
    this.broadcast('data-sub-done', id, data);
  }

  broadcastError(id: string, error: string): void {
    this.broadcast('data-sub-error', id, { error });
  }

  broadcastProgress(id: string, message: string): void {
    this.broadcast('data-sub-progress', id, { message });
  }
}
