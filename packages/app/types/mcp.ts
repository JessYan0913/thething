/**
 * Type definitions for MCP App integration
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Tool metadata structure
 */
export interface McpToolMeta {
  ui?: {
    resourceUri: string;
    entityType?: string;
    visibility?: 'model-and-app' | 'app-only' | 'model-only';
  };
}

/**
 * Widget tool registration interface
 */
export interface WidgetTool {
  name: string;
  schema: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  };
  handler: (args: any) => Promise<any>;
}

/**
 * Tool call parameters (JSON-RPC style)
 */
export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * Tool call result (JSON-RPC style)
 */
export interface ToolCallResult {
  jsonrpc: '2.0';
  result?: CallToolResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP Widget props
 */
export interface McpWidgetProps {
  resourceUri: string;
  serverName: string;
  serverUrl?: string;
  toolInput: Record<string, unknown>;
  isFinal: boolean;
  toolName: string;
  onSendMessage?: (params: unknown) => void;
}

/**
 * Streaming preview props
 */
export interface StreamingPreviewProps {
  input: Record<string, unknown>;
  toolName: string;
  className?: string;
}

/**
 * Tool state from AI SDK
 */
export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

/**
 * Extended tool part with MCP metadata
 */
export interface McpToolPart {
  type: 'dynamic-tool';
  toolName: string;
  state: ToolState;
  input?: Record<string, unknown>;
  output?: any;
  errorText?: string;
}
