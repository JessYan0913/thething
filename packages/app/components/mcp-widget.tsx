'use client';

import { cn } from '@/lib/utils';
import {
  AppBridge,
  PostMessageTransport,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {
  McpUiHostCapabilities,
  McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Loader2Icon, Maximize2Icon, Minimize2Icon } from 'lucide-react';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface McpWidgetProps {
  resourceUri: string;
  /** MCP 服务器 HTTP URL（stdio 类型可为空字符串） */
  serverUrl: string;
  /** MCP 服务器名称，用于代理 JSON-RPC tool call 请求 */
  serverName?: string;
  /** 工具输入参数（流式中间值为 partial，最终值为 complete） */
  toolInput?: Record<string, unknown>;
  /** 工具是否已完成（output-available），false 时发送 partial 通知 */
  isFinal?: boolean;
  /** 工具名称（如 create_view），用于 hostContext.toolInfo */
  toolName?: string;
  className?: string;
  /** 当 Widget 请求发送消息到对话时 */
  onSendMessage?: (text: string) => void;
}

/**
 * MCP App Widget Host — 基于官方 @modelcontextprotocol/ext-apps SDK。
 *
 * 支持两种 MCP server 模式：
 * - HTTP/SSE：serverUrl 有值，HTML 通过 URL 获取，注入 fetch 代理
 * - stdio：serverUrl 为空，HTML 通过 serverName 从后端 API 获取，无需 fetch 代理
 *
 * 协议流程：
 * 1. HTML 获取 → POST /api/mcp/resource
 * 2. Blob URL iframe 渲染（HTTP 模式注入 fetch 代理）
 * 3. AppBridge.connect(PostMessageTransport) → 自动处理 ui/initialize 握手
 * 4. oninitialized → sendToolInput / sendToolInputPartial
 * 5. toolInput / isFinal 变化 → 自动发送对应通知
 * 6. widget → oncalltool 代理到 MCP 服务器
 * 7. widget → onmessage 转发到对话
 * 8. widget → onrequestdisplaymode 切换 inline/fullscreen
 */
export const McpWidget = memo(function McpWidget({
  resourceUri,
  serverUrl,
  serverName,
  toolInput,
  isFinal = false,
  toolName,
  className,
  onSendMessage,
}: McpWidgetProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const initializedRef = useRef(false);
  const lastSentRef = useRef('');
  const toolInputRef = useRef(toolInput);
  toolInputRef.current = toolInput;
  const isFinalRef = useRef(isFinal);
  isFinalRef.current = isFinal;

  // ---- 从 serverUrl 提取 origin（用于 fetch 代理） ----
  const hubOrigin = useMemo(() => {
    try {
      const url = new URL(serverUrl);
      return url.origin;
    } catch {
      return serverUrl.replace(/\/mcp$/, '').replace(/\/$/, '');
    }
  }, [serverUrl]);

  // ---- 获取 Widget HTML（stdio 用 serverName，HTTP 用 serverUrl） ----
  const fetchHtml = useCallback(
    async (uri: string, srvUrl: string, srvName?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/mcp-app-host', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'read-resource',
            uri: uri,
            serverUrl: srvUrl || undefined,
            serverName: srvName || undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // API 返回 { contents: [{ text: html }] }
        const html = data.contents?.[0]?.text || data.html || '';
        setHtml(html);
      } catch (err: any) {
        setError(err.message || 'Failed to load widget');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchHtml(resourceUri, serverUrl, serverName);
  }, [fetchHtml, resourceUri, serverUrl, serverName]);

  // ---- 连接 AppBridge ----
  const handleIframeLoad = useCallback(async () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    // 清理旧连接
    const prev = bridgeRef.current;
    if (prev) {
      try { await prev.close(); } catch { /* ignore */ }
      bridgeRef.current = null;
    }
    initializedRef.current = false;
    lastSentRef.current = '';

    const hostInfo = { name: serverName || 'thething', version: '1.0.0' };
    const capabilities: McpUiHostCapabilities = {
      serverTools: { listChanged: false },
      openLinks: {},
      logging: {},
    };

    const hostContext: McpUiHostContext = { theme: 'dark' };
    if (toolName) {
      hostContext.toolInfo = {
        tool: {
          name: toolName,
          inputSchema: { type: 'object', properties: {} },
        },
      };
    }

    const bridge = new AppBridge(null, hostInfo, capabilities, { hostContext });

    // ---- widget → host: 代理工具调用到 MCP 服务器 ----
    bridge.oncalltool = async (params): Promise<CallToolResult> => {
      if (!serverName) {
        return {
          content: [{ type: 'text', text: 'Error: no serverName configured' }],
          isError: true,
        };
      }
      try {
        const res = await fetch('/api/mcp-app-host', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'call-tool',
            serverName,
            toolName: params.name,
            arguments: params.arguments,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        return (await res.json()) as CallToolResult;
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: err.message || 'Proxy error' }],
          isError: true,
        };
      }
    };

    // ---- widget → host: 转发消息到对话 ----
    bridge.onmessage = async ({ content }) => {
      if (content?.length) {
        const text = (content as Array<{ type: string; text?: string }>)
          .map((c) => c.text ?? '')
          .join(' ');
        if (text.trim()) onSendMessage?.(text.trim());
      }
      return {};
    };

    // ---- widget → host: 更新模型上下文 ----
    bridge.onupdatemodelcontext = async () => ({});
    // Remove this when we want to actually store context for future turns

    // ---- widget → host: 请求全屏/内联切换 ----
    bridge.onrequestdisplaymode = async ({ mode }) => {
      const nextMode: 'inline' | 'fullscreen' =
        mode === 'fullscreen' ? 'fullscreen' : 'inline';
      setExpanded(nextMode === 'fullscreen');
      try {
        bridge.setHostContext({ displayMode: nextMode });
      } catch { /* ignore if bridge closed */ }
      return { mode: nextMode };
    };

    // ---- 初始化完成 → 发送 tool-input ----
    bridge.oninitialized = () => {
      initializedRef.current = true;
      const input = toolInputRef.current;
      if (!input || Object.keys(input).length === 0) return;

      const final = isFinalRef.current;
      const key = JSON.stringify({ input, final });
      lastSentRef.current = key;

      if (final) {
        bridge.sendToolInput({ arguments: input });
      } else {
        bridge.sendToolInputPartial({ arguments: input });
      }
    };

    const transport = new PostMessageTransport(
      iframe.contentWindow,
      iframe.contentWindow,
    );
    await bridge.connect(transport);
    bridgeRef.current = bridge;
  }, [serverName, toolName, onSendMessage]);

  // ---- toolInput / isFinal 变化 → 发送通知 ----
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !initializedRef.current) return;
    if (!toolInput || Object.keys(toolInput).length === 0) return;

    const key = JSON.stringify({ input: toolInput, final: isFinal });
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;

    if (isFinal) {
      bridge.sendToolInput({ arguments: toolInput });
    } else {
      bridge.sendToolInputPartial({ arguments: toolInput });
    }
  }, [toolInput, isFinal]);

  // ---- host → widget: 手动切换 expanded 时同步 displayMode ----
  const handleToggleExpand = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      const bridge = bridgeRef.current;
      if (bridge) {
        try {
          bridge.setHostContext({
            displayMode: next ? 'fullscreen' : 'inline',
          });
        } catch { /* ignore */ }
      }
      return next;
    });
  }, []);

  // ---- 清理 ----
  useEffect(() => {
    return () => {
      const bridge = bridgeRef.current;
      if (bridge) {
        bridge.close().catch(() => {});
        bridgeRef.current = null;
      }
    };
  }, []);

  // ---- Blob URL（HTTP 模式注入 fetch 代理，stdio 模式跳过） ----
  const blobUrl = useMemo(() => {
    if (!html) return '';
    // stdio 模式无需 fetch 代理：widget 所有 MCP 调用通过 postMessage → AppBridge → /api/mcp/proxy
    if (!serverUrl) {
      return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    }
    // HTTP 模式注入 fetch 代理，将 /api/* 请求重写到 MCP server 自身 origin
    const fetchProxy =
      '<script>' +
      '(function(){var o=' +
      JSON.stringify(hubOrigin) +
      ',f=window.fetch;window.fetch=function(i,t){var u=typeof i==="string"?i:(i&&i.url)||"";' +
      'if(u&&u.startsWith("/api/"))return f.call(window,o+u,t);return f.call(window,i,t)};})();' +
      '<' +
      '/script>';
    return URL.createObjectURL(
      new Blob([fetchProxy + html], { type: 'text/html' }),
    );
  }, [html, serverUrl, hubOrigin]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  // ---- 渲染 ----
  if (loading) {
    return (
      <div className="flex items-center gap-2 my-2 px-3 py-6 text-sm text-muted-foreground justify-center bg-muted/20 rounded-xl border border-border/30">
        <Loader2Icon className="size-4 animate-spin" /> Loading widget...
      </div>
    );
  }

  if (error) {
    return (
      <div className="my-2 px-3 py-4 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-200 dark:border-red-800/30">
        Widget load failed: {error}
      </div>
    );
  }

  if (!html) return null;

  return (
    <div
      className={cn(
        'my-2 rounded-xl border border-border/40 overflow-hidden bg-background transition-all',
        expanded
          ? 'fixed inset-4 z-50 shadow-2xl'
          : 'min-h-[320px] max-h-[480px]',
        className,
      )}
    >
      {/* 头部栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/20">
        <span className="text-xs text-muted-foreground font-medium">
          {toolName || resourceUri}
        </span>
        <button
          onClick={handleToggleExpand}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
          title={expanded ? '退出全屏' : '全屏'}
        >
          {expanded ? (
            <Minimize2Icon className="size-3.5" />
          ) : (
            <Maximize2Icon className="size-3.5" />
          )}
        </button>
      </div>

      {/* iframe */}
      <iframe
        ref={iframeRef}
        src={blobUrl}
        className="w-full border-0"
        style={{ height: expanded ? 'calc(100% - 36px)' : '400px' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="MCP Widget"
        onLoad={handleIframeLoad}
      />
    </div>
  );
});
