/**
 * MCP App 动态渲染组件
 *
 * 从 MCP 服务器动态获取工具元数据，检测是否有 UI 资源，然后渲染 Widget
 */
'use client';

import { McpWidget } from '@/components/mcp-widget';
import useSWR from 'swr';
import { Loader2Icon } from 'lucide-react';
import type { ToolUIPart } from 'ai';

interface McpAppDynamicRendererProps {
  messageId: string;
  partIndex: number;
  toolPart: ToolUIPart;
  toolName: string;
  serverName: string;
  onSendMessage?: (text: string) => void;
}

// 从 mcp__serverName__toolName 提取 serverName
function extractServerName(fullToolName: string): string | null {
  if (!fullToolName.startsWith('mcp__')) return null;
  const parts = fullToolName.split('__');
  return parts.length >= 3 ? parts[1] : null;
}

// 从 mcp__serverName__toolName 提取 base toolName
function extractBaseToolName(fullToolName: string): string {
  if (!fullToolName.startsWith('mcp__')) return fullToolName;
  const parts = fullToolName.split('__');
  return parts.length >= 3 ? parts.slice(2).join('__') : fullToolName;
}

export function McpAppDynamicRenderer({
  messageId,
  partIndex,
  toolPart,
  toolName,
  serverName,
  onSendMessage,
}: McpAppDynamicRendererProps) {
  const baseToolName = extractBaseToolName(toolName);

  // 动态获取工具元数据
  const { data: toolMeta, error } = useSWR<{ _meta: Record<string, unknown> | null }>(
    `/api/mcp/tool-meta?name=${encodeURIComponent(baseToolName)}&server=${encodeURIComponent(serverName)}`,
    (url: string) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, revalidateOnMount: true, dedupingInterval: 60000 }
  );

  // 动态获取服务器 URL
  const { data: serverUrls } = useSWR<Record<string, string>>(
    '/api/mcp/servers',
    (url: string) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, revalidateOnMount: true, dedupingInterval: 60000 }
  );

  // 检查是否有 UI 资源
  const uiMeta = (toolMeta?._meta as any)?.ui as Record<string, unknown> | undefined;
  const widgetResourceUri =
    toolPart.state !== 'output-error' && toolPart.state !== 'output-denied'
      ? (uiMeta?.resourceUri as string | undefined)
      : null;

  // 没有 UI 资源，不渲染（让父组件继续处理）
  if (!toolMeta) {
    // 正在加载
    return null;
  }

  if (!widgetResourceUri) {
    // 没有 UI 资源，不是 MCP App
    return null;
  }

  const isFinal = toolPart.state === 'output-available' || toolPart.state === 'approval-responded';
  const mcpServerUrl = serverUrls?.[serverName] || '';

  // 从 _meta.ui 动态读取 entityType（如 skill/connector/agent/mcp），注入到 toolInput
  const entityType = uiMeta?.entityType as string | undefined;
  const toolInput = toolPart.input as Record<string, unknown> | undefined;
  const enrichedInput = entityType && toolInput ? { ...toolInput, entityType } : toolInput;

  return (
    <McpWidget
      key={`${messageId}-${partIndex}`}
      resourceUri={widgetResourceUri}
      serverUrl={mcpServerUrl}
      serverName={serverName}
      toolInput={enrichedInput}
      isFinal={isFinal}
      toolName={baseToolName}
      onSendMessage={onSendMessage}
    />
  );
}
