'use client';

import { useEffect, useRef, useState } from 'react';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpWidgetProps } from '@/types/mcp';

/**
 * MCP App Widget 组件
 *
 * 功能：
 * 1. 从后端 API 获取 HTML 资源
 * 2. 创建 Blob URL 并在 iframe 中渲染
 * 3. 通过 AppBridge 建立双向通信
 * 4. 代理工具调用到后端 /api/mcp/proxy
 * 5. 支持流式 input（partial vs final）与工具结果下发
 */
export function McpWidget({
  resourceUri,
  serverName,
  serverUrl,
  toolInput,
  isFinal,
  toolName,
  toolResult,
  onSendMessage,
}: McpWidgetProps & { toolResult?: CallToolResult }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // View 完成 initialized 握手后才允许 sendToolInput/sendToolResult（规范要求，
  // 且 ref 变化不触发重渲染，必须用 state 驱动下方两个发送 effect）
  const [bridgeReady, setBridgeReady] = useState(false);

  // 1. 获取 HTML 资源
  useEffect(() => {
    let cancelled = false;

    const fetchResource = async () => {
      try {
        const res = await fetch('/api/mcp/resource', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverName, resourceUri }),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Failed to fetch resource');
        }

        const data = await res.json();
        if (!cancelled) {
          setHtml(data.html);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setLoading(false);
        }
      }
    };

    fetchResource();
    return () => { cancelled = true; };
  }, [resourceUri, serverName]);

  // 2. 创建 Blob URL（可选：注入 fetch 代理用于 HTTP 模式）
  useEffect(() => {
    if (!html) return;

    let processedHtml = html;

    // HTTP 模式：注入 fetch 代理
    if (serverUrl) {
      const origin = window.location.origin;
      const fetchProxy = `
        <script>
          (function() {
            const originalFetch = window.fetch;
            window.fetch = async function(url, options) {
              // 相对路径转为绝对路径
              const absoluteUrl = new URL(url, '${serverUrl}').href;
              // 通过父窗口的 origin 代理
              return originalFetch('${origin}' + new URL(absoluteUrl).pathname, options);
            };
          })();
        </script>
      `;
      processedHtml = html.replace(/<head>/i, `<head>${fetchProxy}`);
    }

    const blob = new Blob([processedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [html, serverUrl]);

  // 3. 初始化 AppBridge
  useEffect(() => {
    if (!blobUrl || !iframeRef.current || !iframeRef.current.contentWindow) {
      return;
    }

    const iframe = iframeRef.current;
    let bridge: AppBridge | null = null;

    const initBridge = async () => {
      try {
        // Host 信息
        const hostInfo = {
          name: 'thething',
          version: '1.0.0',
        };

        // 能力声明（McpUiHostCapabilities）
        const capabilities = {
          openLinks: {},
          serverTools: {},
          serverResources: {},
          message: { text: {} },
        };

        // Host 上下文
        const hostContext = {
          displayMode: 'inline' as const,
          theme: document.documentElement.classList.contains('dark') ? ('dark' as const) : ('light' as const),
          platform: 'web' as const,
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          userAgent: 'thething/1.0.0',
          deviceCapabilities: {
            hover: matchMedia('(hover: hover)').matches,
            touch: 'ontouchstart' in window,
          },
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          availableDisplayModes: ['inline' as const],
        };

        bridge = new AppBridge(null, hostInfo, capabilities, { hostContext });

        // 工具调用处理器：代理到 MCP Server
        bridge.oncalltool = async (params: any) => {
          try {
            const { name, arguments: args } = params;
            console.log('[McpWidget] Calling server tool:', name);
            const res = await fetch(`/api/mcp/proxy?server=${serverName}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/call',
                params: {
                  name,
                  arguments: args || {},
                },
              }),
            });

            if (!res.ok) {
              throw new Error(`Tool call failed: ${res.statusText}`);
            }

            const result = await res.json();
            return result.result;
          } catch (err) {
            console.error('[McpWidget] Tool call error:', err);
            throw err;
          }
        };

        // 消息处理器
        if (onSendMessage) {
          bridge.onmessage = async (params) => {
            onSendMessage(params);
            return {};
          };
        }

        // 链接打开处理器
        bridge.onopenlink = async (params) => {
          window.open(params.url, '_blank', 'noopener,noreferrer');
          return {};
        };

        // 显示模式请求处理器：目前只支持 inline 模式
        bridge.onrequestdisplaymode = async () => {
          return { mode: 'inline' as const };
        };

        // 连接到 iframe
        const contentWindow = iframe.contentWindow;
        if (!contentWindow) {
          throw new Error('iframe contentWindow unavailable');
        }
        const transport = new PostMessageTransport(contentWindow, contentWindow);

        bridge.addEventListener('initialized', () => setBridgeReady(true));

        await bridge.connect(transport);
        bridgeRef.current = bridge;
      } catch (err) {
        console.error('[McpWidget] Bridge initialization error:', err);
        setError(err instanceof Error ? err.message : 'Bridge initialization failed');
      }
    };

    // 等待 iframe 加载完成
    const handleLoad = () => {
      initBridge();
    };

    if (iframe.contentDocument?.readyState === 'complete') {
      initBridge();
    } else {
      iframe.addEventListener('load', handleLoad);
      return () => iframe.removeEventListener('load', handleLoad);
    }
  }, [blobUrl, serverName, onSendMessage]);

  // 4. 发送工具 input（流式 vs 完成）
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !bridgeReady) return;

    const sendInput = async () => {
      try {
        if (isFinal) {
          await bridge.sendToolInput({ arguments: toolInput });
        } else {
          await bridge.sendToolInputPartial({ arguments: toolInput });
        }
      } catch (err) {
        console.error('[McpWidget] Send input error:', err);
      }
    };

    sendInput();
  }, [toolInput, isFinal, bridgeReady]);

  // 5. 工具执行结果下发（MCP Apps 规范：sendToolResult 必须在 sendToolInput 之后）
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !bridgeReady || !toolResult) return;

    bridge.sendToolResult(toolResult).catch((err) => {
      console.error('[McpWidget] Send result error:', err);
    });
  }, [toolResult, bridgeReady]);

  // 渲染
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 border rounded-lg bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Loading MCP App...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 border rounded-lg bg-destructive/10">
        <div className="text-sm text-destructive">
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  if (!blobUrl) {
    return null;
  }

  return (
    <div className="w-full h-80 border rounded-lg overflow-hidden bg-background">
      <iframe
        ref={iframeRef}
        src={blobUrl}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin"
        title={`MCP App: ${toolName}`}
      />
    </div>
  );
}
