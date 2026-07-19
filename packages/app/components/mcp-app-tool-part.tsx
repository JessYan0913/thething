'use client';

import { useEffect, useState } from 'react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpWidget } from '@/components/mcp-widget';
import type { McpToolMeta } from '@/types/mcp';

interface McpAppToolPartProps {
  /** qualified 工具名：mcp__<serverName>__<toolName> */
  toolName: string;
  /** ai SDK 的 tool part state（含 approval-* 等扩展状态） */
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  onSendMessage?: (text: string) => void;
}

// 模块级缓存：同一 server/tool 的 _meta 只探测一次（含并发去重）
const toolMetaCache = new Map<string, Promise<McpToolMeta | null>>();

function fetchToolMeta(serverName: string, baseToolName: string): Promise<McpToolMeta | null> {
  const cacheKey = `${serverName}__${baseToolName}`;
  let cached = toolMetaCache.get(cacheKey);
  if (!cached) {
    cached = fetch(
      `/api/mcp/tool-meta?name=${encodeURIComponent(baseToolName)}&server=${encodeURIComponent(serverName)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data?._meta as McpToolMeta | undefined) ?? null)
      .catch(() => null);
    toolMetaCache.set(cacheKey, cached);
  }
  return cached;
}

/**
 * MCP App 工具渲染入口：
 * 从 qualified 工具名解析 server/base 名，探测工具 _meta.ui.resourceUri，
 * 是 MCP App 则渲染 McpWidget，否则返回 null（普通 MCP 工具零影响）。
 */
export function McpAppToolPart({ toolName, state, input, output, errorText, onSendMessage }: McpAppToolPartProps) {
  const [meta, setMeta] = useState<McpToolMeta | null>(null);

  const [, serverName, ...rest] = toolName.split('__');
  const baseToolName = rest.join('__');

  useEffect(() => {
    if (!serverName || !baseToolName) return;
    let cancelled = false;
    fetchToolMeta(serverName, baseToolName).then((result) => {
      if (!cancelled) setMeta(result);
    });
    return () => {
      cancelled = true;
    };
  }, [serverName, baseToolName]);

  const resourceUri = meta?.ui?.resourceUri;
  if (!serverName || !baseToolName || !resourceUri) return null;

  // 工具执行未正常产出结果的终态 → 通知 App tool-cancelled（规范 MUST）
  const cancelReason =
    state === 'output-error' ? (errorText || 'Tool execution failed')
    : state === 'output-denied' ? 'Tool execution denied by user'
    : undefined;

  return (
    <McpWidget
      resourceUri={resourceUri}
      serverName={serverName}
      toolName={baseToolName}
      toolInput={input ?? {}}
      isFinal={state !== 'input-streaming'}
      toolResult={state === 'output-available' ? (output as CallToolResult) : undefined}
      cancelReason={cancelReason}
      onSendMessage={(params) => {
        if (!onSendMessage) return;
        // MCP App 发来的消息：提取 text content 转发给 agent
        const content = (params as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
        const text = content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text)
          .join('\n');
        if (text) onSendMessage(text);
      }}
    />
  );
}
