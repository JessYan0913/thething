# MCP Apps 实现方案

## 概述

MCP Apps 是 AI SDK 的一项功能，它扩展了 Model Context Protocol (MCP) 工具，增加了交互式 UI 资源支持。模型仍然调用普通的 MCP 工具，但工具可以指向一个包含 HTML 的 `ui://` 资源，应用可以在沙箱 iframe 中渲染这些 HTML。

## 核心概念

### 1. MCP Apps 架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP Server    │    │   MCP Host      │    │   MCP App       │
│   (Tools)       │◄──►│   (Your App)    │◄──►│   (UI Resource) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   Sandbox iframe │
                       │   (HTML Render)  │
                       └─────────────────┘
```

### 2. 核心组件

- **`@ai-sdk/mcp`**：提供 MCP Apps 支持的辅助函数
  - `mcpAppClientCapabilities`：通告 MCP Apps 支持
  - `splitMCPAppTools`：分割工具可见性
  - `readMCPAppResource`：读取 UI 资源

- **`@ai-sdk/react`**：提供 React 组件渲染 iframe
  - `experimental_MCPAppRenderer`：渲染 MCP App 的 React 组件

### 3. 宿主流程

1. **连接 MCP 服务器**：使用 MCP Apps 客户端能力
2. **列出工具**：按 MCP Apps 可见性分割工具
3. **暴露模型可见工具**：只将模型可见的工具传递给 `streamText` 或 `generateText`
4. **读取应用资源**：当工具部分包含 MCP App 元数据时，读取 `ui://` 资源
5. **渲染 HTML**：在沙箱 iframe 中渲染 HTML 资源
6. **代理请求**：将允许的 iframe 请求（如 app-visible 工具调用）代理回 MCP 服务器

## 项目现状分析

### 现有 MCP 实现

当前项目已具备完整的 MCP 基础设施：

1. **配置管理**：通过 `.agents/mcp.json` 文件管理 MCP 服务器配置
2. **连接管理**：`McpRegistry` 类负责 MCP 服务器的连接、断开和工具管理
3. **工具过滤**：支持按 include/exclude 规则过滤工具
4. **前端集成**：Chat 组件已集成 AI SDK 的 `useChat` 和工具调用功能

### 技术栈

- **前端**：Next.js 16、React 19、AI SDK 7
- **后端**：Node.js、TypeScript
- **MCP 支持**：`@ai-sdk/mcp`、`@modelcontextprotocol/sdk`

## 实现步骤

### 第一步：更新依赖版本

确保使用最新版本的 AI SDK：

```bash
# 更新 core 包依赖
cd packages/core
pnpm update @ai-sdk/mcp ai @modelcontextprotocol/sdk

# 更新 app 包依赖
cd packages/app
pnpm update @ai-sdk/react ai
```

### 第二步：修改 MCP 客户端连接

在 `packages/core/src/modules/mcp/registry.ts` 中添加 MCP Apps 支持：

```typescript
import { createMCPClient, mcpAppClientCapabilities } from '@ai-sdk/mcp';

// 在 connect 方法中添加 MCP Apps 能力
async connect(config: McpServerConfig): Promise<McpClientConnection> {
  // ... 现有代码 ...
  
  try {
    // 添加 MCP Apps 能力
    const client = await createMCPClient({
      transport: transport as McpTransport,
      capabilities: {
        ...(config.elicitation?.enabled ? { elicitation: {} } : {}),
        ...mcpAppClientCapabilities, // 添加 MCP Apps 能力
      },
    });
    
    // ... 其余代码 ...
  }
}
```

### 第三步：添加工具可见性分割

在 `packages/core/src/modules/mcp/registry.ts` 中添加工具分割逻辑：

```typescript
import { splitMCPAppTools } from '@ai-sdk/mcp';

// 添加获取所有工具（包括 app 可见）的方法
getAllToolsWithAppVisibility(): { modelVisible: ToolSet; appVisible: ToolSet } {
  let modelVisible: ToolSet = {};
  let appVisible: ToolSet = {};
  
  for (const [, conn] of this._connections) {
    const tools = conn.tools as ToolSet;
    const { modelVisible: mv, appVisible: av } = splitMCPAppTools(Object.values(tools));
    modelVisible = { ...modelVisible, ...mv };
    appVisible = { ...appVisible, ...av };
  }
  
  return { modelVisible, appVisible };
}

// 修改 getAllTools 方法，只返回模型可见的工具
getAllTools(): ToolSet {
  const { modelVisible } = this.getAllToolsWithAppVisibility();
  return modelVisible;
}
```

### 第四步：添加 API 端点

创建新的 API 端点来处理 MCP Apps 资源：

#### 4.1 创建 MCP App Host 路由

**文件**：`packages/app/app/api/mcp-app-host/route.ts`

```typescript
import { readMCPAppResource, splitMCPAppTools } from '@ai-sdk/mcp';
import { createMcpRegistry } from '@the-thing/core';

export async function POST(req: Request) {
  const { uri, action, name, arguments: toolArguments } = await req.json();
  
  // 获取 MCP 注册表（需要从您的应用状态中获取）
  const registry = createMcpRegistry();
  
  if (action === 'read-resource') {
    // 读取 MCP App 资源
    const client = registry.getConnection('your-server-name')?.client;
    if (!client) {
      return Response.json({ error: 'MCP client not found' }, { status: 404 });
    }
    
    const resource = await readMCPAppResource({ client, uri });
    return Response.json(resource);
  }
  
  if (action === 'call-tool') {
    // 代理 app 可见的工具调用
    const { appVisible } = registry.getAllToolsWithAppVisibility();
    const isAllowed = Object.keys(appVisible).includes(name);
    
    if (!isAllowed) {
      return Response.json({ error: 'Tool is not app-visible' }, { status: 403 });
    }
    
    const result = await registry.callTool(name, toolArguments);
    return Response.json(result);
  }
  
  return Response.json({ error: 'Invalid action' }, { status: 400 });
}
```

#### 4.2 创建沙箱代理路由

**文件**：`packages/app/app/mcp-app-sandbox/route.ts`

```typescript
export async function GET(req: Request) {
  // 返回沙箱 HTML 页面
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>MCP App Sandbox</title>
        <style>
          body { margin: 0; padding: 0; font-family: system-ui, sans-serif; }
        </style>
      </head>
      <body>
        <div id="root"></div>
        <script>
          // MCP Apps 桥接脚本
          window.MCPAppBridge = {
            callTool: async (params) => {
              return new Promise((resolve, reject) => {
                window.parent.postMessage({
                  type: 'mcp-app-call-tool',
                  ...params
                }, '*');
                
                window.addEventListener('message', function handler(event) {
                  if (event.data.type === 'mcp-app-call-tool-response') {
                    window.removeEventListener('message', handler);
                    resolve(event.data.result);
                  }
                });
              });
            },
            openLink: (url) => {
              window.parent.postMessage({
                type: 'mcp-app-open-link',
                url
              }, '*');
            }
          };
        </script>
      </body>
    </html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
```

### 第五步：修改前端 Chat 组件

在 `packages/app/components/Chat.tsx` 中添加 MCP Apps 渲染：

```typescript
import { experimental_MCPAppRenderer as MCPAppRenderer } from '@ai-sdk/react';
import { isToolUIPart } from 'ai';

// 添加资源加载函数
const loadResource = async (app: { resourceUri: string }) => {
  const response = await fetch('/api/mcp-app-host', {
    method: 'POST',
    body: JSON.stringify({ 
      action: 'read-resource', 
      uri: app.resourceUri 
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to load MCP App resource');
  }
  
  return response.json();
};

// 添加处理器
const handlers = {
  callTool: (params: { name: string; arguments: Record<string, unknown> }) =>
    fetch('/api/mcp-app-host', {
      method: 'POST',
      body: JSON.stringify({ action: 'call-tool', ...params }),
    }).then(response => response.json()),
  openLink: ({ url }: { url: string }) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    return {};
  },
};

// 在消息渲染部分添加 MCP Apps 支持
{messages.map(message =>
  message.parts.map((part, index) => {
    if (part.type === 'text') {
      return <div key={index}>{part.text}</div>;
    }
    
    // 检查是否是工具 UI 部分
    if (isToolUIPart(part)) {
      return (
        <MCPAppRenderer
          key={part.toolCallId}
          part={part}
          loadResource={loadResource}
          handlers={handlers}
          sandbox={{
            url: '/mcp-app-sandbox',
            className: 'h-80 w-full rounded-lg border',
            style: { border: 0 },
          }}
          fallback={<div>Loading MCP App...</div>}
        />
      );
    }
    
    // ... 其他工具渲染逻辑 ...
  })
)}
```

### 第六步：添加类型定义

在 `packages/core/src/modules/mcp/types.ts` 中添加 MCP Apps 相关类型：

```typescript
// MCP Apps 相关类型
export interface MCPAppMetadata {
  resourceUri: string;
  mimeType: string;
  sandboxConfig?: MCPAppSandboxConfig;
}

export interface MCPAppSandboxConfig {
  url: string;
  className?: string;
  style?: React.CSSProperties;
}

export interface MCPAppResource {
  html: string;
  csp?: string;
  permissions?: string[];
}

export interface MCPAppBridgeHandlers {
  callTool: (params: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  openLink: (params: { url: string }) => void;
}
```

## 安全注意事项

### 1. 沙箱隔离

确保 iframe 使用 `sandbox` 属性，限制权限：

```typescript
const sandbox = {
  url: '/mcp-app-sandbox',
  className: 'h-80 w-full rounded-lg border',
  style: { border: 0 },
  // 添加沙箱属性
  sandboxAttributes: {
    allow: 'scripts', // 只允许脚本执行
    sandbox: 'allow-scripts allow-same-origin', // 限制权限
  },
};
```

### 2. CSP 策略

设置严格的内容安全策略：

```typescript
// 在沙箱路由中添加 CSP 头
const response = new Response(html, {
  headers: {
    'Content-Type': 'text/html',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  },
});
```

### 3. 工具验证

在代理工具调用前验证工具可见性：

```typescript
// 验证工具是否为 app 可见
const { appVisible } = registry.getAllToolsWithAppVisibility();
const isAllowed = Object.keys(appVisible).includes(name);

if (!isAllowed) {
  return Response.json({ error: 'Tool is not app-visible' }, { status: 403 });
}
```

### 4. 资源验证

验证 `ui://` 资源的 MIME 类型和内容：

```typescript
// 在 readMCPAppResource 中验证
if (!resource.mimeType.startsWith('text/html')) {
  throw new Error('Invalid MIME type for MCP App resource');
}
```

## 测试策略

### 1. 单元测试

为工具分割逻辑添加测试：

```typescript
describe('MCP Apps Tool Splitting', () => {
  it('should split tools by visibility', () => {
    const tools = [
      { name: 'tool1', _meta: { ui: { visibility: 'model' } } },
      { name: 'tool2', _meta: { ui: { visibility: 'app' } } },
      { name: 'tool3' }, // 默认为 model 可见
    ];
    
    const { modelVisible, appVisible } = splitMCPAppTools(tools);
    
    expect(Object.keys(modelVisible)).toContain('tool1');
    expect(Object.keys(modelVisible)).toContain('tool3');
    expect(Object.keys(appVisible)).toContain('tool2');
  });
});
```

### 2. 集成测试

测试 MCP Apps 资源加载和渲染：

```typescript
describe('MCP Apps Integration', () => {
  it('should load and render MCP App resource', async () => {
    // 模拟 MCP 服务器
    const mockServer = createMockMCPServer({
      tools: [{
        name: 'dashboard',
        _meta: { ui: { visibility: 'model', resourceUri: 'ui://dashboard' } },
      }],
      resources: {
        'ui://dashboard': { html: '<div>Dashboard</div>' },
      },
    });
    
    // 测试资源加载
    const resource = await readMCPAppResource({
      client: mockServer.client,
      uri: 'ui://dashboard',
    });
    
    expect(resource.html).toBe('<div>Dashboard</div>');
  });
});
```

### 3. 安全测试

验证沙箱隔离和权限控制：

```typescript
describe('MCP Apps Security', () => {
  it('should block unauthorized tool calls', async () => {
    const response = await callAppVisibleTool({
      name: 'unauthorized-tool',
      arguments: {},
    });
    
    expect(response.status).toBe(403);
  });
  
  it('should validate resource MIME types', async () => {
    await expect(
      readMCPAppResource({
        client: mockClient,
        uri: 'ui://invalid',
      })
    ).rejects.toThrow('Invalid MIME type');
  });
});
```

## 部署注意事项

### 1. 环境变量

确保设置必要的环境变量：

```env
# MCP 服务器配置
MCP_SERVER_URL=http://localhost:3001
MCP_SERVER_API_KEY=your-api-key

# 安全配置
CSP_POLICY=default-src 'self'
SANDBOX_ORIGIN=https://sandbox.yourdomain.com
```

### 2. CORS 配置

如果使用单独的沙箱源，需要配置 CORS：

```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/mcp-app-host/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'https://sandbox.yourdomain.com' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
};
```

### 3. 性能优化

- **资源缓存**：缓存 MCP App 资源，避免重复加载
- **懒加载**：只在需要时加载 MCP App 资源
- **压缩**：启用 gzip/brotli 压缩

## 监控和日志

### 1. 错误监控

```typescript
// 在 API 端点中添加错误监控
try {
  const resource = await readMCPAppResource({ client, uri });
  return Response.json(resource);
} catch (error) {
  console.error('Failed to load MCP App resource:', error);
  // 发送到错误监控服务
  Sentry.captureException(error);
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}
```

### 2. 性能监控

```typescript
// 记录资源加载时间
const startTime = Date.now();
const resource = await readMCPAppResource({ client, uri });
const loadTime = Date.now() - startTime;

console.log(`MCP App resource loaded in ${loadTime}ms`);
```

## 参考资料

- [AI SDK MCP Apps 文档](https://ai-sdk.dev/docs/ai-sdk-core/mcp-apps)
- [Model Context Protocol 规范](https://modelcontextprotocol.io)
- [AI SDK GitHub 仓库](https://github.com/vercel/ai)

## 差距分析

> 当前实现的详细差距审计，请参见 [MCP Apps 实现差距分析](mcp-apps-gap-analysis.md)。

该文档基于官方 MCP Apps 规范 (SEP-1865) 对当前实现进行了完整性审查，发现了 15 项差距，其中 **3 项致命差距**直接导致了 MCP App 渲染不完整的问题。

## 更新日志

- **2026-07-15**：补充差距分析文档引用，详见 [mcp-apps-gap-analysis.md](mcp-apps-gap-analysis.md)
- **2026-07-07**：初始版本，包含完整的实现方案和安全建议