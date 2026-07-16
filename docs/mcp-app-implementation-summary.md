# MCP App 渲染实现总结

> 实施日期：2026-07-17
> 基于 sime-agent 的 McpWidget 组件参考实现

---

## 实施内容

### 1. 核心组件

#### ✅ McpWidget 组件 (`packages/app/components/mcp-widget.tsx`)

从 sime-agent 移植并适配的完整 MCP App Widget 组件：

**主要特性：**
- 基于官方 `@modelcontextprotocol/ext-apps/app-bridge` SDK
- 支持 HTTP/SSE 和 stdio 两种传输模式
- 实现完整的 MCP Apps 协议：
  - `ui/initialize` 握手（由 AppBridge 自动处理）
  - 流式 input 支持（`tool-input-partial` → `tool-input`）
  - 工具调用代理（`oncalltool` → `/api/mcp-app-host`）
  - 消息转发（`onmessage` → Agent）
  - 显示模式切换（`onrequestdisplaymode`）
- Blob URL iframe 渲染（跨域隔离）
- HTTP 模式下注入 fetch 代理

**适配修改：**
- API 路径从 `/api/mcp/resource` 改为 `/api/mcp-app-host`
- API 调用格式适配 thething 的统一接口
- 工具调用代理适配 `/api/mcp-app-host` 的 `action: 'call-tool'` 格式
- 主机名称从 'sime-agent' 改为 'thething'

#### ✅ McpAppDynamicRenderer 组件 (`packages/app/components/mcp-app-dynamic-renderer.tsx`)

动态检测和渲染 MCP App 的辅助组件：

**功能：**
- 通过 `useSWR` 动态获取工具的 `_meta.ui` 信息
- 从 MCP 服务器名称映射获取 serverUrl
- 检测 `_meta.ui.resourceUri` 判断是否为 MCP App
- 有 UI 资源时渲染 `McpWidget`，否则返回 null 让父组件继续处理
- 支持 `entityType` 注入（从 `_meta.ui.entityType`）

**工具名称解析：**
- 从 `mcp__serverName__toolName` 格式提取 serverName 和 baseToolName
- 用于动态 API 查询和工具调用

### 2. API 路由

#### ✅ `/api/mcp/tool-meta` (`app/api/mcp/tool-meta/route.ts`)

获取 MCP 工具的元数据（包括 `_meta.ui` 信息）

**请求：**
```
GET /api/mcp/tool-meta?name=create_view&server=mcp-color-picker
```

**响应：**
```json
{
  "_meta": {
    "ui": {
      "resourceUri": "ui://color-picker",
      "entityType": "mcp",
      "visibility": "app-only"
    }
  }
}
```

**实现：**
- 从 AppContext 获取 mcpRegistry
- 查找指定 MCP 服务器的连接
- 从 `client.tools()` 获取工具列表
- 返回匹配工具的 `_meta` 字段

#### ✅ `/api/mcp/servers` (`app/api/mcp/servers/route.ts`)

返回所有 MCP 服务器名称到 URL 的映射

**请求：**
```
GET /api/mcp/servers
```

**响应：**
```json
{
  "mcp-color-picker": "http://localhost:3100/mcp",
  "sime-hub": "https://hub.example.com/mcp"
}
```

**实现：**
- 遍历 mcpRegistry.connections
- 仅返回 HTTP/SSE/streamable-http 类型的服务器 URL
- stdio 类型没有 URL，不返回

### 3. Chat.tsx 集成

#### ✅ 导入和依赖
- 添加 `McpWidget` 导入
- 添加 `McpAppDynamicRenderer` 导入
- 添加 `useSWR` 导入（用于数据获取）

#### ✅ 工具渲染逻辑增强

在现有的 MCP App 检测逻辑（基于 `toolMetadata.app`）之后添加：

```typescript
// 动态检测 MCP App：对于 dynamic-tool 类型，如果 toolMetadata 不包含 app 信息，
// 则从 MCP 服务器动态获取 _meta.ui 来判断是否为 MCP App
if (part.type === 'dynamic-tool') {
  const serverName = extractServerName(toolName);
  if (serverName && !hasAppMeta) {
    return (
      <McpAppDynamicRenderer
        messageId={message.id}
        partIndex={index}
        toolPart={toolPart}
        toolName={fullToolName}
        serverName={serverName}
        onSendMessage={(text) => append({ role: 'user', parts: [{ type: 'text', text }] })}
      />
    );
  }
}
```

**工作流程：**
1. 检测到 `dynamic-tool` 类型
2. 从工具名称提取 serverName（`mcp__serverName__toolName`）
3. 检查是否有静态的 `toolMetadata.app`（@ai-sdk/mcp 提供）
4. 没有静态元数据时，使用 `McpAppDynamicRenderer` 动态获取
5. 动态渲染器返回 `McpWidget` 或 null
6. 返回 null 时继续正常的工具渲染流程

---

## 架构对比

### sime-agent 方案
```
ToolRenderer
  ↓
useSWR → /api/mcp/tool-meta (获取 _meta)
  ↓
检测 _meta.ui.resourceUri
  ↓
<McpWidget> (自实现的组件)
  - AppBridge + PostMessageTransport
  - 直接管理 iframe 和协议
```

### thething 方案（混合架构）
```
Chat.tsx 工具渲染
  ↓
1. 优先：静态检测 toolMetadata.app (@ai-sdk/mcp)
  ↓ 有 → <McpAppSlot> + <AppRenderer> (@mcp-ui/client)
  ↓ 无 ↓
2. 备选：动态检测 _meta.ui
  ↓
<McpAppDynamicRenderer>
  - useSWR → /api/mcp/tool-meta
  - useSWR → /api/mcp/servers
  ↓
<McpWidget> (移植自 sime-agent)
  - AppBridge + PostMessageTransport
  - 直接管理 iframe 和协议
```

**优势：**
- 保留了现有的 `@mcp-ui/client` 方案（更符合官方规范）
- 添加了动态检测作为备选（解决元数据缺失问题）
- 两种方案互补，提高兼容性

---

## 关键差异解决

### 问题：为什么 sime-agent 能正常渲染？

**根本原因：**

sime-agent 使用**动态元数据获取**：
```typescript
// 运行时从 MCP 服务器查询工具元数据
const { data: toolMeta } = useSWR(
  `/api/mcp/tool-meta?name=${toolName}&server=${serverName}`
);

// 检测 _meta.ui.resourceUri
if (toolMeta?._meta?.ui?.resourceUri) {
  return <McpWidget resourceUri={...} />;
}
```

thething 原本依赖**静态元数据**：
```typescript
// 依赖 @ai-sdk/mcp 在工具注册时设置的 toolMetadata
const appMeta = part.toolMetadata?.app;
if (appMeta?.resourceUri) {
  return <McpAppSlot resourceUri={...} />;
}
```

**问题：** 如果 `@ai-sdk/mcp` 没有正确设置 `toolMetadata.app`，MCP App 就无法被检测到。

**解决方案：** 添加动态检测作为备选，兼容两种情况。

---

## 测试建议

### 1. 基础渲染测试
- [ ] 使用 mcp-color-picker 测试工具调用
- [ ] 确认 Widget iframe 正确加载
- [ ] 确认工具输入参数正确传递

### 2. 流式输入测试
- [ ] 测试 partial input 更新（`tool-input-partial`）
- [ ] 测试 final input 传递（`tool-input`）
- [ ] 确认 Widget 响应 input 变化

### 3. 工具调用代理测试
- [ ] Widget 内调用工具（`oncalltool`）
- [ ] 确认请求正确转发到 `/api/mcp-app-host`
- [ ] 确认结果正确返回到 Widget

### 4. 消息转发测试
- [ ] Widget 发送消息（`onmessage`）
- [ ] 确认消息添加到对话
- [ ] 确认 Agent 能接收和响应

### 5. 显示模式测试
- [ ] 测试全屏/内联切换
- [ ] 确认 Widget 接收 `displayMode` 更新

### 6. 错误处理测试
- [ ] 资源加载失败
- [ ] 工具调用失败
- [ ] MCP 服务器断开连接

---

## 已知限制

1. **双 iframe 异源隔离：**
   - 当前使用 Blob URL 实现 origin: null
   - 完全隔离需要独立的 sandbox 域名
   - 功能上不影响 MCP App 正常工作

2. **Fetch 代理注入：**
   - HTTP 模式下注入的 fetch 代理是字符串拼接
   - 可能与某些复杂的 HTML 结构冲突
   - stdio 模式不受影响

3. **元数据缓存：**
   - 使用 `useSWR` 缓存 60 秒
   - 工具元数据变化后需要刷新页面
   - 可以通过 `mutate()` 手动刷新

---

## 下一步工作

### 优先级 P0（核心功能）
- [x] McpWidget 组件移植
- [x] 动态元数据获取 API
- [x] Chat.tsx 集成
- [ ] 实际测试和调试

### 优先级 P1（体验优化）
- [ ] 加载状态优化（骨架屏）
- [ ] 错误提示优化
- [ ] 重试机制
- [ ] 元数据预加载

### 优先级 P2（高级特性）
- [ ] 离线资源缓存
- [ ] 自定义 CSP 策略
- [ ] 性能监控
- [ ] 调试工具

---

## 文件清单

**新增文件：**
1. `packages/app/components/mcp-widget.tsx` - MCP Widget 组件
2. `packages/app/components/mcp-app-dynamic-renderer.tsx` - 动态渲染器
3. `packages/app/app/api/mcp/tool-meta/route.ts` - 工具元数据 API
4. `packages/app/app/api/mcp/servers/route.ts` - 服务器列表 API

**修改文件：**
1. `packages/app/components/Chat.tsx` - 添加动态检测逻辑
   - 导入 McpWidget 和 McpAppDynamicRenderer
   - 添加 dynamic-tool 检测分支
   - 集成 onSendMessage 回调

**依赖文件（已存在）：**
1. `packages/app/app/api/mcp-app-host/route.ts` - MCP App 宿主 API
2. `packages/core/src/modules/mcp/registry.ts` - MCP Registry
3. `packages/app/lib/runtime.ts` - Runtime 上下文

---

## 总结

通过移植 sime-agent 的 McpWidget 组件并添加动态元数据获取机制，thething 现在具备完整的 MCP App 渲染能力。混合架构设计既保留了符合官方规范的 `@mcp-ui/client` 方案，又通过动态检测解决了静态元数据可能缺失的问题，提供了更好的兼容性和可靠性。
