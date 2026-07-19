'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import { AppBridge, PostMessageTransport, buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiResourceCsp, McpUiResourcePermissions } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpWidgetProps } from '@/types/mcp';

// ext-apps 的 PostMessageTransport 会对每条 postMessage 打 debug 日志且无开关
// （收发消息、非目标窗口的消息如 React DevTools / Next.js dev overlay 等），
// 这里精确过滤掉这些噪音日志
const NOISY_DEBUG_PREFIXES = [
  'Ignoring message from unknown source',
  'Sending message',
  'Parsed message',
];
if (typeof window !== 'undefined' && !(window as unknown as Record<string, unknown>).__mcpDebugFiltered) {
  (window as unknown as Record<string, unknown>).__mcpDebugFiltered = true;
  const originalDebug = console.debug.bind(console);
  console.debug = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && NOISY_DEBUG_PREFIXES.some((p) => (args[0] as string).startsWith(p))) return;
    originalDebug(...args);
  };
}

// 注入到 iframe 内的同款过滤脚本（父窗口的 console patch 管不到 iframe 内部）
const IFRAME_DEBUG_FILTER = `
  <script>
    (function() {
      var prefixes = ${JSON.stringify(NOISY_DEBUG_PREFIXES)};
      var originalDebug = console.debug.bind(console);
      console.debug = function() {
        var first = arguments[0];
        if (typeof first === 'string' && prefixes.some(function(p) { return first.indexOf(p) === 0; })) return;
        originalDebug.apply(null, arguments);
      };
    })();
  </script>
`;

/**
 * 按 MCP Apps 规范将资源声明的 csp 元数据构建为 CSP 字符串。
 * 未声明的域一律不放行（规范默认值的超集仅限 data:/blob: 内联数据）。
 * 注入为 <meta> 标签：srcdoc 文档无法设置 HTTP header，meta 是唯一注入点；
 * CSP meta 位于文档最前，先于任何脚本解析，App 代码无法撤销。
 */
function buildCspMetaTag(csp?: McpUiResourceCsp): string {
  const resourceSrc = ["'self'", "'unsafe-inline'", 'data:', 'blob:', ...(csp?.resourceDomains ?? [])].join(' ');
  const connectSrc = csp?.connectDomains?.length ? csp.connectDomains.join(' ') : "'none'";
  const frameSrc = csp?.frameDomains?.length ? csp.frameDomains.join(' ') : "'none'";
  const baseUri = csp?.baseUriDomains?.length ? ["'self'", ...csp.baseUriDomains].join(' ') : "'self'";
  const directives = [
    "default-src 'none'",
    `script-src ${resourceSrc}`,
    `style-src ${resourceSrc}`,
    `img-src ${resourceSrc}`,
    `font-src ${resourceSrc}`,
    `media-src ${resourceSrc}`,
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    `base-uri ${baseUri}`,
    "object-src 'none'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${directives}">`;
}

/** 资源接口返回的 _meta.ui（服务器声明的安全/展示元数据） */
interface ResourceUiMeta {
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
  prefersBorder?: boolean;
}

/**
 * MCP App Widget 组件
 *
 * 安全模型（对规范双 iframe 沙箱的单 iframe 等效实现）：
 * - iframe 用 srcdoc + sandbox（无 allow-same-origin）→ 文档获得 opaque origin，
 *   与宿主异源，App 无法触碰宿主 DOM / cookie / storage
 * - 服务器声明的 csp 元数据编译为 <meta> CSP 注入文档头部，未声明域一律阻断
 * - permissions 元数据映射为 iframe allow 属性（Permission Policy）
 * 规范的双 iframe 方案需要一个真实的第二源（独立域名/端口）托管 sandbox proxy
 * 页面，当前部署形态没有；opaque origin 达成同等隔离，代价是 App 内
 * localStorage 等持久化 API 不可用（规范沙箱下多数宿主同样如此）。
 */
export function McpWidget({
  resourceUri,
  serverName,
  serverUrl,
  toolInput,
  isFinal,
  toolName,
  toolResult,
  cancelReason,
  onSendMessage,
}: McpWidgetProps & { toolResult?: CallToolResult }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [uiMeta, setUiMeta] = useState<ResourceUiMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 懒挂载：滚入视口附近才真正加载 App。历史对话里 N 个 Excalidraw 级别的
  // App 同时挂载会把 Chat 页主线程直接卡死；屏幕外只渲染占位框，
  // 滚到才激活（激活后保持挂载不回收）
  const [activated, setActivated] = useState(false);
  // View 完成 initialized 握手后才允许 sendToolInput/sendToolResult（规范要求，
  // 且 ref 变化不触发重渲染，必须用 state 驱动下方两个发送 effect）
  const [bridgeReady, setBridgeReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // View 通过 size-changed 通知的内容高度（规范 MUST 响应）
  const [appHeight, setAppHeight] = useState<number | null>(null);
  // View 主动请求关闭（ui/notifications/request-teardown）后进入关闭态
  const [tornDown, setTornDown] = useState(false);

  // 懒挂载：观察占位容器，进入视口前 300px 即激活
  useEffect(() => {
    if (activated) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActivated(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [activated]);

  // 放大时按 Esc 还原
  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  // 1. 获取 HTML 资源（激活后才开始，屏幕外的 App 不发请求）
  useEffect(() => {
    if (!activated) return;
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
          setUiMeta(data.ui ?? null);
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
  }, [activated, resourceUri, serverName]);

  // 2. 处理 HTML：CSP meta 置于最前 + debug 过滤 + 可选 fetch 代理（HTTP 模式）
  const processedHtml = useMemo(() => {
    if (!html) return null;

    const cspMeta = buildCspMetaTag(uiMeta?.csp);
    const headInjection = `${cspMeta}${IFRAME_DEBUG_FILTER}`;
    let result = /<head>/i.test(html)
      ? html.replace(/<head>/i, `<head>${headInjection}`)
      : `${headInjection}${html}`;

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
      result = result.replace(/<head>/i, `<head>${fetchProxy}`);
    }

    return result;
  }, [html, uiMeta, serverUrl]);

  // onSendMessage 用 ref 持有：父组件每次渲染传入新的内联函数引用，
  // 若作为下方 effect 的依赖会导致 bridge 反复重建（旧 bridge 不销毁则会
  // 重复响应 open-link 等请求，出现点一次开 N 个标签页的 bug）
  const onSendMessageRef = useRef(onSendMessage);
  useEffect(() => {
    onSendMessageRef.current = onSendMessage;
  }, [onSendMessage]);

  // input/result/cancel 的内容级去重记录（bridge 重建时清空）
  const lastSentInputRef = useRef<string | null>(null);
  const lastSentResultRef = useRef<string | null>(null);
  const cancelSentRef = useRef(false);

  // 3. 初始化 AppBridge
  useEffect(() => {
    if (!processedHtml || tornDown || !iframeRef.current || !iframeRef.current.contentWindow) {
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

        // 能力声明（McpUiHostCapabilities）。
        // 不变式：声明的每个 capability 必须有对应 handler，规范 App 会信任
        // 声明直接调用；serverResources 未实现故不声明
        const capabilities = {
          openLinks: {},
          serverTools: {},
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

        // 工具调用处理器：代理到 MCP Server（服务端校验 visibility）
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

            const result = await res.json();
            if (!res.ok || result.error) {
              throw new Error(result.error?.message || `Tool call failed: ${res.statusText}`);
            }
            return result.result;
          } catch (err) {
            console.error('[McpWidget] Tool call error:', err);
            throw err;
          }
        };

        // 工具列表处理器（serverTools capability 的另一半，只返回 app 可见工具）。
        // onlisttools 在 1.7.4 运行时存在但 d.ts 漏声明，故断言
        (bridge as AppBridge & { onlisttools: (params: unknown) => Promise<unknown> }).onlisttools = async () => {
          const res = await fetch(`/api/mcp/proxy?server=${serverName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {} }),
          });
          const result = await res.json();
          if (!res.ok || result.error) {
            throw new Error(result.error?.message || 'tools/list failed');
          }
          return result.result;
        };

        // 消息处理器（读 ref，避免把 onSendMessage 加进 effect 依赖）
        bridge.onmessage = async (params) => {
          onSendMessageRef.current?.(params);
          return {};
        };

        // 链接打开处理器
        bridge.onopenlink = async (params) => {
          window.open(params.url, '_blank', 'noopener,noreferrer');
          return {};
        };

        // 显示模式请求处理器：目前只支持 inline 模式
        bridge.onrequestdisplaymode = async () => {
          return { mode: 'inline' as const };
        };

        // View 内容尺寸变化（规范 MUST 响应并调整 iframe 高度）
        bridge.onsizechange = ({ height }) => {
          if (height != null && Number.isFinite(height)) {
            setAppHeight(Math.min(Math.max(Math.ceil(height), 160), 800));
          }
        };

        // View 主动请求关闭：按规范走优雅终止（先 ui/resource-teardown 再卸载）
        bridge.onrequestteardown = () => {
          const b = bridge;
          b?.teardownResource({})
            .catch(() => {})
            .finally(() => setTornDown(true));
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

        // bridge 就位后才注入文档：srcdoc 赋值触发（重新）加载，监听器必然
        // 先于 View 的 ui/initialize 就绪，彻底杜绝握手竞态（-32001）。
        // StrictMode 重挂载 / effect 重跑同理——每次都是全新文档全新握手
        iframe.srcdoc = processedHtml;
      } catch (err) {
        console.error('[McpWidget] Bridge initialization error:', err);
        setError(err instanceof Error ? err.message : 'Bridge initialization failed');
      }
    };

    initBridge();

    // 清理：先按规范发 ui/resource-teardown（MUST），随即销毁 bridge。
    // 不等待响应：等待期间旧 bridge 会与新 bridge 并存，重复应答同一 iframe
    // 的请求（一次 open-link 开 N 个标签页的旧 bug）；且清理后文档即被
    // 替换/移除，响应通常已无法送达
    return () => {
      const b = bridge;
      if (b) {
        b.teardownResource({}).catch(() => {});
        b.close().catch(() => {});
      }
      if (bridgeRef.current === bridge) {
        bridgeRef.current = null;
      }
      setBridgeReady(false);
      // bridge 重建后 App 会重新握手，需要完整重发 input/result，清空去重记录
      lastSentInputRef.current = null;
      lastSentResultRef.current = null;
      cancelSentRef.current = false;
    };
  }, [processedHtml, tornDown, serverName]);

  // 4. 发送工具 input（流式 vs 完成）
  // 按内容而非引用去重：Chat 流式期间每个 token 都重渲染，input ?? {} 等
  // 路径会产生新引用；不去重会对已挂载 App 反复重发相同 input，
  // Excalidraw 每次收到都会全量重放绘制动画，主线程被打满导致页面卡死
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !bridgeReady) return;

    const serialized = `${isFinal ? 'F' : 'P'}:${JSON.stringify(toolInput)}`;
    if (lastSentInputRef.current === serialized) return;
    lastSentInputRef.current = serialized;

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
  // 同样按内容去重，避免流式重渲染期间重复下发
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !bridgeReady || !toolResult) return;

    const serialized = JSON.stringify(toolResult);
    if (lastSentResultRef.current === serialized) return;
    lastSentResultRef.current = serialized;

    bridge.sendToolResult(toolResult).catch((err) => {
      console.error('[McpWidget] Send result error:', err);
    });
  }, [toolResult, bridgeReady]);

  // 6. 工具取消通知（规范 MUST：执行失败/被拒绝时告知 View，避免其永久等待）
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !bridgeReady || !cancelReason || cancelSentRef.current) return;
    cancelSentRef.current = true;
    bridge.sendToolCancelled({ reason: cancelReason }).catch((err) => {
      console.error('[McpWidget] Send cancelled error:', err);
    });
  }, [cancelReason, bridgeReady]);

  // 7. 主题变化通知（host-context-changed）
  useEffect(() => {
    if (!bridgeReady) return;
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.classList.contains('dark') ? ('dark' as const) : ('light' as const);
      bridgeRef.current?.setHostContext({ theme });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
  }, [bridgeReady]);

  // 渲染
  if (tornDown) {
    return (
      <div className="flex items-center justify-center p-4 border rounded-lg bg-muted/30 text-sm text-muted-foreground">
        MCP App 已关闭
      </div>
    );
  }

  // 未激活 / 加载中：占位框（containerRef 供 IntersectionObserver 观察）
  if (!activated || loading) {
    return (
      <div ref={containerRef} className="flex items-center justify-center p-8 border rounded-lg bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {activated && (
            <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
          {activated ? 'Loading MCP App...' : `MCP App: ${toolName}`}
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

  if (!processedHtml) {
    return null;
  }

  const allowAttr = buildAllowAttribute(uiMeta?.permissions ?? undefined);

  return (
    <>
      {/* 放大时的背景遮罩，点击还原 */}
      {expanded && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setExpanded(false)}
        />
      )}
      {/* 注意：放大/还原只切换 CSS，不能卸载 iframe，否则 AppBridge 连接会断开 */}
      <div
        className={
          expanded
            ? 'fixed inset-4 z-50 border rounded-lg overflow-hidden bg-background shadow-2xl'
            : 'relative h-80 w-full border rounded-lg overflow-hidden bg-background'
        }
        style={!expanded && appHeight ? { height: appHeight } : undefined}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-background/80 backdrop-blur border text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
          title={expanded ? '还原 (Esc)' : '放大'}
        >
          {expanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
        </button>
        {/*
          srcdoc 由 bridge effect 在监听器就位后注入（不走 JSX 属性）。
          sandbox 刻意不含 allow-same-origin：srcdoc 文档因此获得 opaque
          origin，与宿主异源隔离——这是整个安全模型的根基，勿加回
        */}
        <iframe
          ref={iframeRef}
          className="size-full border-0"
          sandbox="allow-scripts allow-forms"
          allow={allowAttr || undefined}
          title={`MCP App: ${toolName}`}
        />
      </div>
    </>
  );
}
