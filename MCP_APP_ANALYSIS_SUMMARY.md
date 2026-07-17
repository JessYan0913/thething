# MCP App 实现分析总结

## 核心发现

通过对比 [Three.js MCP Server 示例](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server) 和我们的实现，发现以下关键差异和改进建议。

## 1. 架构优劣对比

### Three.js 官方示例的优势

✅ **原生 SDK 集成**
- 使用 `@modelcontextprotocol/ext-apps/react` 的 `useApp()` 钩子
- 自动处理 PostMessage 通信和 JSON-RPC 协议
- 内置错误处理和重连逻辑

✅ **Widget 内工具注册**
```typescript
app.registerTool("set-scene-source", schema, handler)
```
- 允许 Widget 暴露自己的工具给 AI
- 支持 Widget → AI → Widget 的闭环交互
- **我们的实现缺失这个能力**

✅ **流式预览体验**
```typescript
const isStreaming = !toolInputs && !!toolInputsPartial;
```
- 清晰区分部分输入 (`toolInputsPartial`) 和最终输入 (`toolInputs`)
- LoadingShimmer 组件实时显示生成中的代码
- 自动滚动到底部，提供即时反馈

✅ **单文件打包**
- 使用 `vite-plugin-singlefile` 打包为自包含 HTML
- 所有 CSS/JS 内联，无外部依赖
- 便于分发和嵌入

### 我们实现的优势

✅ **后端代理架构**
- 所有 MCP 通信在服务端，避免客户端暴露连接
- 统一的 McpRegistry 管理多服务器连接
- 适合企业级安全要求

✅ **动态元数据查询**
- 运行时通过 `/api/mcp/tool-meta` 查询 `_meta.ui`
- 无需静态配置，支持动态服务器连接
- 自动降级到标准 Tool 组件

✅ **与现有 Chat UI 集成**
- `ToolRenderer` 统一入口，透明处理 MCP App 和标准工具
- 复用现有的 Tool 组件样式和交互
- 与 AI SDK 的 `useChat` 无缝集成

## 2. 关键差距

### ❌ 缺失：Widget 内工具注册

**Three.js 示例**:
```typescript
// Widget 可以注册工具供 AI 调用
app.registerTool("set-scene-source", { ... }, async (args) => {
  sceneStateRef.current.code = args.code;
  return { success: true };
});

// AI 可以调用 Widget 的工具
await app.callServerTool("set-scene-source", { code: "..." });
```

**我们的实现**: 只支持代理 MCP Server 的工具，Widget 无法暴露自己的能力。

**影响**: Widget 只能被动接收输入，无法主动参与对话循环。

### ❌ 缺失：流式预览 UI

**Three.js 示例**:
- 显示生成中的代码 (`toolInputsPartial.code`)
- 滚动条自动跟随
- 视觉反馈清晰

**我们的实现**: 
- 只传递 `isFinal` 标志
- 流式 UI 需要 Widget 作者自己实现
- 缺乏统一的加载状态指示

### ❌ 不一致：工具调用流程

**Three.js 示例**:
```typescript
Widget 调用 → app.callServerTool() → SDK 内部处理 JSON-RPC
```

**我们的实现**:
```typescript
Widget 调用 → AppBridge.oncalltool → fetch('/api/mcp/proxy') → 手动 JSON-RPC
```

**问题**: 
- 重复造轮子，SDK 已有的能力未利用
- 错误处理和重试逻辑需要自己维护
- 增加维护成本

## 3. 改进建议

### 优先级 P0: 支持 Widget 内工具注册

**问题**: Widget 无法暴露工具给 AI 调用。

**方案**: 在 `McpWidget` 中添加 `app.registerTool()` 的代理逻辑。

**实现思路**:
```typescript
// 1. Widget 通过 AppBridge 注册工具
app.registerTool("widget-action", schema, handler);

// 2. McpWidget 接收注册请求
bridge.onregistertool = async (params) => {
  // 将工具元数据存储到状态
  setWidgetTools(prev => [...prev, params]);
};

// 3. AI 调用时，路由到对应的 handler
const result = await widgetTools.find(t => t.name === toolName)?.handler(args);
```

**收益**: 
- Widget 可以实现复杂的交互循环
- 例如：Color Picker 可以注册 `adjust-saturation` 工具
- AI 可以渐进式调整颜色，而不是一次性输入

### 优先级 P1: 改进流式输入体验

**问题**: 流式预览依赖 Widget 作者自己实现。

**方案**: 在 `McpWidget` 外层包裹通用的流式预览 UI。

**实现思路**:
```typescript
<McpWidget ...>
  {!isFinal && (
    <StreamingOverlay>
      <ShimmerEffect />
      <CodePreview code={part.input} />
    </StreamingOverlay>
  )}
  <iframe ... />
</McpWidget>
```

**收益**:
- 所有 MCP App 自动获得一致的加载状态
- 用户立即看到 AI 正在生成输入
- 减少"卡住"的感觉

### 优先级 P2: 简化工具调用代理

**问题**: 手动处理 JSON-RPC 增加复杂度。

**方案**: 考虑使用 `@ai-sdk/mcp` 的客户端能力。

**实现思路**:
```typescript
import { createMCPClient } from '@ai-sdk/mcp';

// 在 Widget 内创建客户端（指向我们的代理 API）
const client = createMCPClient({
  transport: new HttpTransport({ url: `/api/mcp/proxy?server=${serverName}` })
});

// 使用 SDK 的 callTool 方法
const result = await client.callTool({ name, arguments });
```

**收益**:
- 复用 SDK 的错误处理、重试、类型检查
- 减少样板代码
- 未来 SDK 升级自动获得新特性

### 优先级 P3: 优化资源缓存

**问题**: 每次渲染都从后端获取 HTML。

**方案**: 
1. 后端添加 HTTP 缓存头（`Cache-Control: max-age=3600`）
2. 前端使用 `stale-while-revalidate` 策略

**实现思路**:
```typescript
// /api/mcp/resource/route.ts
return NextResponse.json({ html }, {
  headers: {
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
  }
});

// mcp-widget.tsx
const { data: html } = useSWR(
  `/api/mcp/resource?server=${serverName}&uri=${resourceUri}`,
  fetcher,
  {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
    revalidateIfStale: false // 使用过期数据，后台更新
  }
);
```

## 4. 架构决策权衡

### 保持后端代理 vs 切换到前端直连

**后端代理（当前方案）**:
- ✅ 服务端可以做访问控制、审计日志
- ✅ 隐藏 MCP Server 连接信息
- ✅ 统一错误处理和监控
- ❌ 增加延迟（一次额外的网络跳转）
- ❌ 需要维护代理 API

**前端直连（Three.js 方案）**:
- ✅ 减少延迟
- ✅ 充分利用 SDK 能力
- ❌ 需要暴露 MCP Server 端点
- ❌ CORS 配置复杂
- ❌ 安全性依赖客户端

**建议**: 保持后端代理，但优化性能：
1. 使用 HTTP/2 多路复用
2. 添加响应缓存
3. 考虑 Server-Sent Events 替代轮询

## 5. 测试用例建议

基于 Three.js 示例，补充以下测试场景：

### 流式输入测试
```typescript
test('should display partial input during streaming', () => {
  render(<ToolRenderer part={{ 
    state: 'input-streaming', 
    input: { code: 'const scene =' }
  }} />);
  
  expect(screen.getByText(/streaming/i)).toBeInTheDocument();
});
```

### Widget 工具调用测试
```typescript
test('should proxy tool calls to backend', async () => {
  const mockFetch = jest.fn().mockResolvedValue({ 
    json: async () => ({ result: { success: true } })
  });
  global.fetch = mockFetch;
  
  const { result } = renderHook(() => useAppBridge(...));
  await result.current.oncalltool({ name: 'test-tool', arguments: {} });
  
  expect(mockFetch).toHaveBeenCalledWith('/api/mcp/proxy?server=test');
});
```

### 资源加载测试
```typescript
test('should fallback to standard Tool on resource error', async () => {
  server.use(
    rest.get('/api/mcp/tool-meta', (req, res, ctx) => {
      return res(ctx.status(404));
    })
  );
  
  render(<ToolRenderer part={{ toolName: 'mcp__server__tool' }} />);
  
  await waitFor(() => {
    expect(screen.getByText(/Tool/)).toBeInTheDocument();
  });
});
```

## 6. 文档和示例

### 建议补充的文档

1. **MCP App 开发指南** - 如何创建一个 Widget
   - 使用 `useApp()` 钩子
   - 注册工具
   - 处理流式输入
   - 打包为单文件 HTML

2. **集成测试指南** - 如何测试 MCP App
   - 本地开发模式
   - E2E 测试策略
   - 调试技巧

3. **迁移指南** - 从 OpenAI Apps 迁移
   - API 对应关系
   - 代码示例
   - 常见问题

### 建议补充的示例

1. **表单输入 Widget** - 类似 Color Picker，但支持多字段
2. **数据可视化 Widget** - 图表渲染
3. **文件上传 Widget** - 演示二进制数据处理

## 总结

| 维度 | Three.js 示例 | 我们的实现 | 优先改进 |
|------|--------------|-----------|---------|
| **SDK 集成** | ✅ 完整 | ⚠️ 部分 | P2 - 简化代理 |
| **工具注册** | ✅ 支持 | ❌ 缺失 | **P0 - 添加支持** |
| **流式预览** | ✅ 优秀 | ⚠️ 依赖 Widget | **P1 - 通用 UI** |
| **安全架构** | ⚠️ 前端直连 | ✅ 后端代理 | - |
| **构建工具** | ✅ 单文件 | ⚠️ 依赖 Widget | P3 - 文档指导 |
| **动态发现** | ❌ 静态 | ✅ 运行时 | - |

**核心建议**: 
1. 优先实现 Widget 工具注册（P0）
2. 添加统一的流式预览 UI（P1）
3. 保持后端代理架构，但优化性能
4. 补充开发文档和示例

通过这些改进，我们可以在保持企业级安全性的同时，获得与官方示例相当的开发体验。
