import type { SubAgentStreamWriter } from './types';

/**
 * Agent 事件类型
 */
export type AgentEventType =
  | 'data-sub-open'
  | 'data-sub-text-delta'
  | 'data-sub-tool-call'
  | 'data-sub-tool-result'
  | 'data-sub-done'
  | 'data-sub-error'
  | 'data-sub-progress';

/**
 * Agent 事件
 */
export interface AgentEvent {
  type: AgentEventType;
  id: string;
  data: Record<string, unknown>;
}

/**
 * 事件广播器
 *
 * 用于向客户端广播 Sub Agent 的执行状态。
 */
export class EventBroadcaster {
  private writer: SubAgentStreamWriter | null;

  constructor(writer: SubAgentStreamWriter | null) {
    this.writer = writer;
  }

  /**
   * 广播事件
   */
  broadcast(type: AgentEventType, id: string, data: Record<string, unknown>): void {
    this.writer?.write({ type, id, data });
  }

  /**
   * 广播开始事件
   */
  broadcastOpen(id: string, agentType: string, task: string): void {
    this.broadcast('data-sub-open', id, { agentType, task });
  }

  /**
   * 广播文本增量
   */
  broadcastTextDelta(id: string, text: string, accumulated: string): void {
    this.broadcast('data-sub-text-delta', id, { text, accumulated });
  }

  /**
   * 广播工具调用
   */
  broadcastToolCall(id: string, name: string, input: Record<string, unknown>): void {
    this.broadcast('data-sub-tool-call', id, { name, input });
  }

  /**
   * 广播工具结果
   */
  broadcastToolResult(id: string, name: string, result: string): void {
    this.broadcast('data-sub-tool-result', id, { name, result });
  }

  /**
   * 广播完成事件
   */
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

  /**
   * 广播错误事件
   */
  broadcastError(id: string, error: string): void {
    this.broadcast('data-sub-error', id, { error });
  }

  /**
   * 广播进度事件
   */
  broadcastProgress(id: string, message: string): void {
    this.broadcast('data-sub-progress', id, { message });
  }
}