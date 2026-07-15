'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { MCPAppMetadata, MCPAppResource, MCPAppBridgeHandlers, MCPAppSandboxConfig } from '@the-thing/core';

/**
 * McpAppView — 使用 @modelcontextprotocol/ext-apps 官方的 AppBridge 渲染 MCP App
 *
 * 替代 @ai-sdk/react 的 experimental_MCPAppRenderer。
 *
 * 设计原则：
 *  - AppBridge 通过 PostMessageTransport 完整处理 ext-apps 协议
 *  - 所有生命周期消息（sandbox-ready、initialize、tool-input/result）由 bridge 自动路由
 *  - 通过 on* 回调接入业务逻辑（callTool、openLink、sendMessage）
 */

interface McpAppViewProps {
  part: unknown;
  loadResource: (app: MCPAppMetadata) => Promise<MCPAppResource>;
  handlers: MCPAppBridgeHandlers;
  sandbox: MCPAppSandboxConfig;
  fallback?: React.ReactNode;
}

function getAppFromPart(part: unknown): MCPAppMetadata | null {
  const toolPart = part as Record<string, unknown> | undefined;
  const toolMetadata = toolPart?.toolMetadata as Record<string, unknown> | undefined;
  const appMeta = toolMetadata?.app as Record<string, unknown> | undefined;
  if (appMeta?.mimeType === 'text/html;profile=mcp-app' && typeof appMeta.resourceUri === 'string') {
    return appMeta as unknown as MCPAppMetadata;
  }
  return null;
}

function getPartInput(part: unknown): Record<string, unknown> | undefined {
  const p = part as Record<string, unknown> | undefined;
  const val = p?.input;
  return typeof val === 'object' && val != null ? val as Record<string, unknown> : undefined;
}

function getPartOutput(part: unknown): Record<string, unknown> | undefined {
  const p = part as Record<string, unknown> | undefined;
  if (p?.state === 'output-available') {
    const val = p.output;
    return typeof val === 'object' && val != null ? val as Record<string, unknown> : undefined;
  }
  return undefined;
}

export function McpAppView({
  part,
  loadResource,
  handlers,
  sandbox,
  fallback = null,
}: McpAppViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const initializedRef = useRef(false);
  const [app, setApp] = useState<MCPAppMetadata | null>(() => getAppFromPart(part));
  const [resource, setResource] = useState<MCPAppResource | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { theme } = useTheme();

  // 提取 app 元数据
  useEffect(() => {
    const a = getAppFromPart(part);
    if (a) setApp(a);
  }, [part]);

  // 加载 ui:// 资源
  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    setError(null);
    loadResource(app)
      .then((r) => { if (!cancelled) setResource(r); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { cancelled = true; };
  }, [app, loadResource]);

  const input = useMemo(() => getPartInput(part), [part]);
  const output = useMemo(() => getPartOutput(part), [part]);

  // 建立 AppBridge 连接
  useEffect(() => {
    if (!resource || !iframeRef.current) return;

    const targetWindow = iframeRef.current.contentWindow;
    if (!targetWindow) return;

    initializedRef.current = false;

    // 1. PostMessageTransport → AppBridge 之间的消息通道
    const transport = new PostMessageTransport(
      targetWindow,
      targetWindow,
    );

    // 2. 创建 AppBridge（无后端 MCP client，所有工具调用通过 oncalltool 回调代理）
    const bridge = new AppBridge(
      undefined as any,
      { name: 'the-thing', version: '1.0.0' },
      { openLinks: {}, logging: {} },
      {
        hostContext: {
          displayMode: 'inline',
          theme: theme === 'dark' ? 'dark' : 'light',
          platform: 'web' as const,
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    );

    // 3. 工具调用代理：App iframe → Host → MCP Server
    bridge.oncalltool = async (params: any) => {
      const result = await handlers.callTool({ name: params.name, arguments: params.arguments ?? {} });
      return result as any;
    };

    // 4. 打开外部链接
    bridge.onopenlink = async (params: any) => {
      handlers.openLink({ url: params.url });
      return {};
    };

    // 5. 消息转发：App → Agent
    bridge.onmessage = async (params: any) => {
      if (handlers.sendMessage) await handlers.sendMessage(params);
      return {};
    };

    // 6. Sandbox 就绪 → 发送 app HTML（不传 CSP，让 sandbox 使用默认策略）
    bridge.onsandboxready = () => {
      bridge.sendSandboxResourceReady({
        html: resource.html,
        sandbox: 'allow-scripts allow-same-origin',
      });
    };

    // 7. App 初始化完成 → 发送 tool input + result
    bridge.oninitialized = () => {
      initializedRef.current = true;
      if (input !== undefined) bridge.sendToolInput({ arguments: input } as any);
      if (output !== undefined) bridge.sendToolResult(output as any);
    };

    bridgeRef.current = bridge;

    // 8. 连接（transport.start() 注册 message listener）
    bridge.connect(transport).catch((err: unknown) => {
      console.error('[McpAppView] bridge.connect failed:', err);
    });

    // 9. 清理
    return () => {
      bridgeRef.current = null;
      bridge.teardownResource({ reason: 'component-unmount' }).catch(() => {});
      bridge.close();
    };
    // resource 变化时重建 bridge
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);

  // 更新 tool input
  useEffect(() => {
    if (!initializedRef.current || !bridgeRef.current) return;
    if (input !== undefined) {
      (bridgeRef.current as any).sendToolInput({ arguments: input });
    }
  }, [input]);

  // 更新 tool result
  useEffect(() => {
    if (!initializedRef.current || !bridgeRef.current) return;
    if (output !== undefined) {
      (bridgeRef.current as any).sendToolResult(output);
    }
  }, [output]);

  if (!app || error || !resource) {
    return <>{fallback}</>;
  }

  return (
    <iframe
      ref={iframeRef}
      title="MCP App"
      aria-label={app.resourceUri}
      src={sandbox.url}
      className={sandbox.className}
      style={sandbox.style as React.CSSProperties}
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
