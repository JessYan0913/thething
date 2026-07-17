# MCP App 实现改进建议 (代码级别)

## 问题 1: 缺失 Widget 内工具注册

### 当前实现的局限

```typescript
// mcp-widget.tsx (当前)
const oncalltool = useCallback(async (params: any) => {
  // ❌ 只能代理 MCP Server 的工具
  const res = await fetch(`/api/mcp/proxy?server=${serverName}`, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: params.name, arguments: params.arguments }
    })
  });
  return await res.json();
}, [serverName]);
```

**问题**: Widget 无法注册自己的工具给 AI 调用。

### 改进方案: 添加本地工具注册和路由

```typescript
// mcp-widget.tsx (改进后)
import { useState, useCallback, useRef } from 'react';

interface WidgetTool {
  name: string;
  schema: any;
  handler: (args: any) => Promise<any>;
}

export function McpWidget({ ... }: McpWidgetProps) {
  // 存储 Widget 注册的工具
  const widgetToolsRef = useRef<Map<string, WidgetTool>>(new Map());
  
  // ① 监听 Widget 注册工具的请求
  useEffect(() => {
    if (!bridgeRef.current) return;
    
    const bridge = bridgeRef.current;
    
    // 拦截 registerTool 调用
    const originalRegisterTool = bridge.app.registerTool;
    bridge.app.registerTool = (name: string, schema: any, handler: any) => {
      console.log('[McpWidget] Widget registered tool:', name);
      widgetToolsRef.current.set(name, { name, schema, handler });
      
      // 仍然调用原始方法，保持 SDK 状态一致
      return originalRegisterTool.call(bridge.app, name, schema, handler);
    };
    
    return () => {
      bridge.app.registerTool = originalRegisterTool;
    };
  }, [bridgeRef.current]);
  
  // ② 修改 oncalltool 回调，添加路由逻辑
  const oncalltool = useCallback(async (params: any) => {
    const { name, arguments: args } = params;
    
    // 检查是否为 Widget 注册的工具
    const widgetTool = widgetToolsRef.current.get(name);
    
    if (widgetTool) {
      // 本地执行
      console.log('[McpWidget] Calling widget tool:', name);
      try {
        const result = await widgetTool.handler(args);
        return {
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: JSON.stringify(result) }]
          }
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Widget tool error'
          }
        };
      }
    }
    
    // 否则代理到 MCP Server
    console.log('[McpWidget] Calling server tool:', name);
    const res = await fetch(`/api/mcp/proxy?server=${serverName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args }
      })
    });
    return await res.json();
  }, [serverName]);
  
  // ... rest of component
}
```

### 使用示例

```typescript
// Widget 内 (mcp-app.tsx)
import { useApp } from '@modelcontextprotocol/ext-apps/react';

function ColorPickerApp() {
  const { app, toolInputs } = useApp();
  const [color, setColor] = useState({ r: 255, g: 0, b: 0 });
  
  useEffect(() => {
    if (!app) return;
    
    // Widget 注册自己的工具
    app.registerTool(
      'adjust-saturation',
      {
        title: 'Adjust Color Saturation',
        description: 'Fine-tune the saturation of current color',
        inputSchema: {
          type: 'object',
          properties: {
            delta: { type: 'number', description: 'Change in saturation (-1 to 1)' }
          }
        }
      },
      async (args) => {
        const newSaturation = Math.max(0, Math.min(1, currentSaturation + args.delta));
        setColor(hsvToRgb(hue, newSaturation, value));
        return { success: true, newSaturation };
      }
    );
  }, [app, color]);
  
  return <div>...</div>;
}
```

**收益**:
- ✅ AI 可以调用 `adjust-saturation` 工具
- ✅ 支持渐进式交互 (AI 可以多次调整颜色)
- ✅ Widget 可以暴露任意复杂的能力

---

## 问题 2: 流式输入体验不佳

### 当前实现的局限

```typescript
// tool-renderer.tsx (当前)
const isFinal = part.state === 'output-available' || 
                part.state === 'output-error' || 
                part.state === 'output-denied';

return (
  <McpWidget
    toolInput={enrichedInput || {}}
    isFinal={isFinal}
    toolName={baseToolName!}
  />
);
```

**问题**: 
- 没有加载状态的视觉反馈
- 用户看不到正在生成的输入内容
- Widget 需要自己实现流式预览

### 改进方案: 添加通用流式预览层

```typescript
// tool-renderer.tsx (改进后)
import { StreamingPreview } from '@/components/streaming-preview';

export function ToolRenderer({ part, ... }: ToolRendererProps) {
  // ... 现有逻辑
  
  if (isMcpTool && resourceUri && serverName) {
    const isFinal = part.state === 'output-available' || 
                    part.state === 'output-error' || 
                    part.state === 'output-denied';
    
    const isStreaming = part.state === 'input-streaming';
    
    return (
      <Tool defaultOpen>
        <ToolHeader ... />
        <ToolContent>
          {/* ✅ 添加流式预览层 */}
          {isStreaming && (
            <StreamingPreview 
              input={part.input} 
              toolName={baseToolName}
            />
          )}
          
          {/* Widget iframe */}
          <McpWidget
            resourceUri={resourceUri}
            serverName={serverName}
            toolInput={enrichedInput || {}}
            isFinal={isFinal}
            toolName={baseToolName!}
            onSendMessage={onSendMessage}
            // ✅ 流式时隐藏 iframe
            hidden={isStreaming}
          />
        </ToolContent>
      </Tool>
    );
  }
  
  // ... 标准工具渲染
}
```

### 创建 StreamingPreview 组件

```typescript
// components/streaming-preview.tsx
import { useEffect, useRef } from 'react';

interface StreamingPreviewProps {
  input: Record<string, unknown>;
  toolName: string;
}

export function StreamingPreview({ input, toolName }: StreamingPreviewProps) {
  const preRef = useRef<HTMLPreElement>(null);
  
  // 自动滚动到底部
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [input]);
  
  return (
    <div className="relative">
      {/* 脉冲动画背景 */}
      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 opacity-50" />
      
      {/* 内容区域 */}
      <div className="relative p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="size-2 animate-pulse rounded-full bg-blue-500" />
          <span>Generating input for {toolName}...</span>
        </div>
        
        {/* 显示部分输入 */}
        <pre
          ref={preRef}
          className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3 text-xs font-mono"
        >
          {JSON.stringify(input, null, 2)}
        </pre>
      </div>
    </div>
  );
}
```

### 修改 McpWidget 支持隐藏

```typescript
// mcp-widget.tsx
export function McpWidget({
  hidden = false,
  ...
}: McpWidgetProps & { hidden?: boolean }) {
  // ... 现有逻辑
  
  return (
    <div 
      className={cn(
        "w-full h-80 border rounded-lg overflow-hidden bg-background transition-opacity",
        hidden && "opacity-0 pointer-events-none h-0"
      )}
    >
      <iframe ... />
    </div>
  );
}
```

**收益**:
- ✅ 所有 MCP App 自动获得一致的流式预览
- ✅ 用户立即看到正在生成的输入
- ✅ 平滑过渡到最终 Widget

---

## 问题 3: 资源缓存不足

### 当前实现的局限

```typescript
// mcp-widget.tsx (当前)
useEffect(() => {
  const fetchResource = async () => {
    const res = await fetch('/api/mcp/resource', {
      method: 'POST',
      body: JSON.stringify({ serverName, resourceUri })
    });
    const data = await res.json();
    setHtml(data.html);
  };
  
  fetchResource();
}, [resourceUri, serverName]);
```

**问题**:
- 每次渲染都重新获取 HTML
- 没有利用 HTTP 缓存
- 浪费带宽和服务器资源

### 改进方案: 添加多层缓存

#### 1. 后端添加 HTTP 缓存头

```typescript
// app/api/mcp/resource/route.ts (改进后)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serverName, resourceUri } = body;
    
    // ... 现有逻辑获取 HTML
    
    const html = htmlContent.text;
    
    // ✅ 添加缓存头
    return NextResponse.json(
      { html },
      {
        headers: {
          // 1小时强缓存，24小时弱缓存
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          // ETag 用于条件请求
          'ETag': `W/"${Buffer.from(html).toString('base64').substring(0, 32)}"`,
          // Vary 确保不同服务器的资源不会混淆
          'Vary': 'Accept-Encoding'
        }
      }
    );
  } catch (error) {
    // ... 错误处理
  }
}
```

#### 2. 前端使用 SWR 缓存

```typescript
// mcp-widget.tsx (改进后)
import useSWR from 'swr';

const fetcher = async (url: string, body: any) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export function McpWidget({ serverName, resourceUri, ... }: McpWidgetProps) {
  // ✅ 使用 SWR 缓存
  const { data, error, isLoading } = useSWR(
    // 缓存键包含 serverName 和 resourceUri
    `mcp-resource:${serverName}:${resourceUri}`,
    () => fetcher('/api/mcp/resource', { serverName, resourceUri }),
    {
      // 只在挂载时获取一次
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // 1小时内不重新验证
      dedupingInterval: 3600000,
      // 使用过期数据，后台静默更新
      revalidateIfStale: true,
      // 永久缓存 (直到刷新页面)
      revalidateOnMount: false,
    }
  );
  
  const html = data?.html;
  
  // ... 现有渲染逻辑
}
```

#### 3. 添加内存缓存层 (可选)

```typescript
// lib/mcp-resource-cache.ts
const resourceCache = new Map<string, { html: string; timestamp: number }>();
const CACHE_TTL = 3600000; // 1小时

export async function getCachedResource(
  serverName: string,
  resourceUri: string
): Promise<string> {
  const cacheKey = `${serverName}:${resourceUri}`;
  const cached = resourceCache.get(cacheKey);
  
  // 检查缓存是否有效
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[Cache] Hit:', cacheKey);
    return cached.html;
  }
  
  // 缓存未命中，获取资源
  console.log('[Cache] Miss:', cacheKey);
  const res = await fetch('/api/mcp/resource', {
    method: 'POST',
    body: JSON.stringify({ serverName, resourceUri })
  });
  const data = await res.json();
  
  // 更新缓存
  resourceCache.set(cacheKey, {
    html: data.html,
    timestamp: Date.now()
  });
  
  return data.html;
}
```

**收益**:
- ✅ 减少 90% 以上的资源请求
- ✅ 更快的加载速度
- ✅ 降低服务器负载
- ✅ 支持离线使用 (stale-while-revalidate)

---

## 问题 4: 错误处理不完善

### 当前实现的局限

```typescript
// mcp-widget.tsx (当前)
if (error) {
  return (
    <div className="text-destructive">
      <strong>Error:</strong> {error}
    </div>
  );
}
```

**问题**:
- 错误信息对用户不友好
- 没有重试机制
- 没有区分错误类型

### 改进方案: 分类错误处理和自动重试

```typescript
// mcp-widget.tsx (改进后)
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, WifiOff, ServerCrash } from 'lucide-react';

// 错误类型判断
function categorizeError(error: Error): {
  type: 'network' | 'server' | 'resource' | 'unknown';
  canRetry: boolean;
} {
  const message = error.message.toLowerCase();
  
  if (message.includes('fetch') || message.includes('network')) {
    return { type: 'network', canRetry: true };
  }
  
  if (message.includes('404') || message.includes('not found')) {
    return { type: 'resource', canRetry: false };
  }
  
  if (message.includes('500') || message.includes('internal')) {
    return { type: 'server', canRetry: true };
  }
  
  return { type: 'unknown', canRetry: true };
}

export function McpWidget({ ... }: McpWidgetProps) {
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;
  
  const { data, error, isLoading, mutate } = useSWR(
    `mcp-resource:${serverName}:${resourceUri}`,
    () => fetcher('/api/mcp/resource', { serverName, resourceUri }),
    {
      // ✅ 自动重试配置
      onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
        const { canRetry } = categorizeError(error);
        
        // 不可重试的错误
        if (!canRetry) return;
        
        // 超过最大重试次数
        if (retryCount >= MAX_RETRIES) return;
        
        // 指数退避: 2^n 秒
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        
        setTimeout(() => revalidate({ retryCount }), delay);
      },
      // 其他配置...
    }
  );
  
  // 错误渲染
  if (error) {
    const { type, canRetry } = categorizeError(error);
    
    const errorConfig = {
      network: {
        icon: WifiOff,
        title: '网络连接失败',
        description: '请检查您的网络连接后重试',
        variant: 'destructive' as const
      },
      resource: {
        icon: AlertCircle,
        title: '资源不存在',
        description: `无法找到 MCP App 资源: ${resourceUri}`,
        variant: 'destructive' as const
      },
      server: {
        icon: ServerCrash,
        title: '服务器错误',
        description: 'MCP 服务器遇到错误，请稍后重试',
        variant: 'destructive' as const
      },
      unknown: {
        icon: AlertCircle,
        title: '未知错误',
        description: error.message,
        variant: 'destructive' as const
      }
    };
    
    const config = errorConfig[type];
    const Icon = config.icon;
    
    return (
      <Alert variant={config.variant}>
        <Icon className="h-4 w-4" />
        <AlertTitle>{config.title}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{config.description}</p>
          
          {/* 重试按钮 */}
          {canRetry && retryCount < MAX_RETRIES && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRetryCount(prev => prev + 1);
                mutate();
              }}
            >
              <RefreshCw className="mr-2 h-3 w-3" />
              重试 ({retryCount + 1}/{MAX_RETRIES})
            </Button>
          )}
          
          {/* 调试信息 (开发模式) */}
          {process.env.NODE_ENV === 'development' && (
            <details className="text-xs opacity-70">
              <summary className="cursor-pointer">技术详情</summary>
              <pre className="mt-2 whitespace-pre-wrap break-all">
                {error.stack}
              </pre>
            </details>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  
  // ... 正常渲染
}
```

**收益**:
- ✅ 用户友好的错误信息
- ✅ 自动重试网络错误
- ✅ 区分可恢复和不可恢复的错误
- ✅ 开发模式下显示详细堆栈

---

## 问题 5: 缺少性能监控

### 改进方案: 添加性能指标收集

```typescript
// lib/mcp-performance.ts
interface McpMetrics {
  resourceLoadTime: number;
  bridgeInitTime: number;
  firstInputTime: number;
  toolCallCount: number;
  errorCount: number;
}

class McpPerformanceMonitor {
  private metrics: Map<string, McpMetrics> = new Map();
  
  startResourceLoad(widgetId: string) {
    const metrics = this.getOrCreateMetrics(widgetId);
    metrics.resourceLoadStart = performance.now();
  }
  
  endResourceLoad(widgetId: string) {
    const metrics = this.getOrCreateMetrics(widgetId);
    metrics.resourceLoadTime = performance.now() - (metrics.resourceLoadStart || 0);
    
    // 上报到监控系统
    this.report('mcp.resource.load', metrics.resourceLoadTime, {
      widgetId,
      phase: 'complete'
    });
  }
  
  recordToolCall(widgetId: string, toolName: string, duration: number, success: boolean) {
    const metrics = this.getOrCreateMetrics(widgetId);
    metrics.toolCallCount++;
    
    if (!success) {
      metrics.errorCount++;
    }
    
    this.report('mcp.tool.call', duration, {
      widgetId,
      toolName,
      success: success.toString()
    });
  }
  
  private report(metric: string, value: number, tags: Record<string, string>) {
    // 集成现有监控系统 (例如 Datadog, New Relic)
    if (typeof window !== 'undefined' && (window as any).DD_RUM) {
      (window as any).DD_RUM.addTiming(metric, value, tags);
    }
    
    // 开发模式下打印
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Metrics] ${metric}:`, value, tags);
    }
  }
  
  private getOrCreateMetrics(widgetId: string): any {
    if (!this.metrics.has(widgetId)) {
      this.metrics.set(widgetId, {
        resourceLoadTime: 0,
        bridgeInitTime: 0,
        firstInputTime: 0,
        toolCallCount: 0,
        errorCount: 0
      });
    }
    return this.metrics.get(widgetId);
  }
}

export const mcpMonitor = new McpPerformanceMonitor();
```

### 在组件中使用

```typescript
// mcp-widget.tsx
import { mcpMonitor } from '@/lib/mcp-performance';

export function McpWidget({ serverName, resourceUri, ... }: McpWidgetProps) {
  const widgetId = `${serverName}:${resourceUri}`;
  
  useEffect(() => {
    mcpMonitor.startResourceLoad(widgetId);
    
    return () => {
      mcpMonitor.endResourceLoad(widgetId);
    };
  }, [widgetId]);
  
  const oncalltool = useCallback(async (params: any) => {
    const startTime = performance.now();
    let success = false;
    
    try {
      const result = await /* ... 工具调用逻辑 ... */;
      success = !result.error;
      return result;
    } finally {
      const duration = performance.now() - startTime;
      mcpMonitor.recordToolCall(widgetId, params.name, duration, success);
    }
  }, [widgetId]);
  
  // ... rest of component
}
```

**收益**:
- ✅ 实时监控 MCP App 性能
- ✅ 识别慢查询和性能瓶颈
- ✅ 追踪错误率和成功率
- ✅ 数据驱动的优化决策

---

## 实施优先级

| 改进 | 优先级 | 工作量 | 影响范围 |
|------|-------|-------|---------|
| Widget 工具注册 | **P0** | 中 (2天) | 核心功能 |
| 流式预览 UI | **P1** | 小 (1天) | 用户体验 |
| 资源缓存 | P1 | 小 (半天) | 性能 |
| 错误处理 | P2 | 小 (1天) | 健壮性 |
| 性能监控 | P3 | 中 (2天) | 可观测性 |

## 下一步行动

1. **立即实施**: Widget 工具注册 (问题 1)
   - 解锁核心交互能力
   - 对标官方示例

2. **本周完成**: 流式预览 + 资源缓存 (问题 2 & 3)
   - 显著提升用户体验
   - 快速见效

3. **下周排期**: 错误处理 + 性能监控 (问题 4 & 5)
   - 提升生产环境可靠性
   - 建立长期优化基线
