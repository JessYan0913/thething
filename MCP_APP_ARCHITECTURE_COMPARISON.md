# MCP App 架构流程对比图

## Three.js 官方示例架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AI Agent / LLM                             │
│  "Create a rotating cube with blue material"                       │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ tools/call: show_threejs_scene
                         │ { code: "const geometry = ...", height: 400 }
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MCP Server (Node.js)                             │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ registerAppTool("show_threejs_scene", {                    │    │
│  │   _meta: { ui: { resourceUri: "ui://threejs/app.html" } }  │    │
│  │ })                                                          │    │
│  └────────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ registerAppResource(resourceUri, async () => {             │    │
│  │   return fs.readFile("dist/mcp-app.html")  // 单文件 HTML  │    │
│  │ })                                                          │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ ① resources/read: ui://threejs/app.html
                         │ ② 返回完整 HTML (内联 CSS/JS)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      MCP Host (Claude Desktop)                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  检测 _meta.ui.resourceUri → 获取资源 → 渲染 iframe        │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ ③ 加载 HTML 到 iframe sandbox
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Widget (iframe 内)                              │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  import { useApp } from '@modelcontextprotocol/ext-apps/react' │
│  │                                                             │    │
│  │  const { app, toolInputs, toolInputsPartial } = useApp()  │    │
│  │                                                             │    │
│  │  // 检测流式输入                                            │    │
│  │  const isStreaming = !toolInputs && !!toolInputsPartial   │    │
│  │                                                             │    │
│  │  if (isStreaming) {                                        │    │
│  │    return <LoadingShimmer code={toolInputsPartial.code} /> │    │
│  │  }                                                          │    │
│  │                                                             │    │
│  │  // 渲染最终结果                                            │    │
│  │  return <Canvas code={toolInputs.code} />                 │    │
│  └────────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  // Widget 可以注册自己的工具                               │    │
│  │  app.registerTool("set-scene-source", schema, async (args) => { │
│  │    updateScene(args.code);                                 │    │
│  │    return { success: true };                               │    │
│  │  });                                                        │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**关键特性**:
- ✅ Widget 可以注册工具 (`app.registerTool`)
- ✅ 清晰的流式输入区分 (`toolInputsPartial` vs `toolInputs`)
- ✅ 单文件 HTML 打包 (vite-plugin-singlefile)
- ✅ SDK 自动处理 PostMessage 和 JSON-RPC

---

## 我们的实现架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI Agent / LLM (Vercel AI SDK)                   │
│  "选择一个颜色"                                                      │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ tools/call: mcp__colorPicker__pick-color
                         │ { /* empty input */ }
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Next.js App (Chat UI)                               │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  const { messages } = useChat({                            │    │
│  │    api: '/api/chat',                                       │    │
│  │    experimental_activeTools: mcpTools  // 包含 MCP 工具    │    │
│  │  });                                                        │    │
│  └────────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  {messages.map(msg => msg.parts.map(part => {             │    │
│  │    if (part.type === 'dynamic-tool') {                    │    │
│  │      return <ToolRenderer part={part} />  // 统一入口      │    │
│  │    }                                                        │    │
│  │  }))}                                                       │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ToolRenderer Component                           │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  // ① 检测 MCP 工具                                         │    │
│  │  const isMcpTool = part.toolName.startsWith('mcp__')      │    │
│  │  const [_, serverName, baseToolName] = toolName.split('__')│   │
│  │                                                             │    │
│  │  // ② 查询元数据                                            │    │
│  │  const { data } = useSWR(                                  │    │
│  │    `/api/mcp/tool-meta?name=${baseToolName}&server=${serverName}`│
│  │  )                                                          │    │
│  │                                                             │    │
│  │  // ③ 根据 resourceUri 决定渲染方式                         │    │
│  │  if (data?._meta?.ui?.resourceUri) {                      │    │
│  │    return <McpWidget resourceUri={...} toolInput={part.input} /> │
│  │  } else {                                                   │    │
│  │    return <Tool input={part.input} output={part.output} /> │    │
│  │  }                                                          │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     McpWidget Component                              │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  // ① 获取 HTML 资源                                        │    │
│  │  useEffect(() => {                                         │    │
│  │    fetch('/api/mcp/resource', {                           │    │
│  │      method: 'POST',                                       │    │
│  │      body: JSON.stringify({ serverName, resourceUri })     │    │
│  │    }).then(r => r.json()).then(d => setHtml(d.html))     │    │
│  │  }, [resourceUri])                                         │    │
│  │                                                             │    │
│  │  // ② 创建 Blob URL                                         │    │
│  │  useEffect(() => {                                         │    │
│  │    if (html) {                                             │    │
│  │      const blob = new Blob([html], { type: 'text/html' }) │    │
│  │      setBlobUrl(URL.createObjectURL(blob))                │    │
│  │    }                                                        │    │
│  │  }, [html])                                                │    │
│  │                                                             │    │
│  │  // ③ 建立 AppBridge 通信                                   │    │
│  │  useEffect(() => {                                         │    │
│  │    const transport = new PostMessageTransport({           │    │
│  │      targetWindow: iframeRef.current.contentWindow,       │    │
│  │      targetOrigin: '*'                                     │    │
│  │    });                                                      │    │
│  │    const bridge = new AppBridge(transport, {              │    │
│  │      oncalltool: async (params) => {                      │    │
│  │        // 代理到后端                                        │    │
│  │        return fetch(`/api/mcp/proxy?server=${serverName}`, {│  │
│  │          method: 'POST',                                   │    │
│  │          body: JSON.stringify({                            │    │
│  │            jsonrpc: '2.0',                                 │    │
│  │            method: 'tools/call',                           │    │
│  │            params                                           │    │
│  │          })                                                 │    │
│  │        }).then(r => r.json())                             │    │
│  │      }                                                      │    │
│  │    });                                                      │    │
│  │    bridgeRef.current = bridge;                            │    │
│  │  }, [iframeRef.current])                                  │    │
│  │                                                             │    │
│  │  // ④ 发送输入到 Widget                                     │    │
│  │  useEffect(() => {                                         │    │
│  │    if (bridge) {                                           │    │
│  │      if (isFinal) {                                        │    │
│  │        bridge.sendToolInput(toolInput);  // 最终输入       │    │
│  │      } else {                                              │    │
│  │        bridge.sendToolInputPartial(toolInput);  // 流式输入│    │
│  │      }                                                      │    │
│  │    }                                                        │    │
│  │  }, [bridge, toolInput, isFinal])                         │    │
│  │                                                             │    │
│  │  return <iframe ref={iframeRef} src={blobUrl} sandbox="..." /> │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         │ ⑤ iframe 加载完成
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Widget (iframe 内)                                  │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  import { useApp } from '@modelcontextprotocol/ext-apps/react' │
│  │                                                             │    │
│  │  const { app, toolInputs } = useApp();                    │    │
│  │                                                             │    │
│  │  // 渲染 UI                                                 │    │
│  │  return <ColorPickerCanvas onConfirm={(color) => {        │    │
│  │    app.sendMessage({ role: 'user', content: color });    │    │
│  │  }} />                                                      │    │
│  │                                                             │    │
│  │  // ❌ 无法注册工具 (未实现)                                │    │
│  │  // app.registerTool(...) 不会被代理                       │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         │ ⑥ 用户交互 (如果需要调用服务器工具)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              POST /api/mcp/proxy?server=colorPicker                  │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  const { params } = await request.json();                  │    │
│  │                                                             │    │
│  │  const connection = mcpRegistry.connections.get(serverName);│   │
│  │  const result = await connection.client.callTool({        │    │
│  │    name: params.name,                                      │    │
│  │    arguments: params.arguments                             │    │
│  │  });                                                        │    │
│  │                                                             │    │
│  │  return { jsonrpc: '2.0', result };                       │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MCP Server (通过 McpRegistry)                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  registerAppTool("pick-color", {                           │    │
│  │    _meta: { ui: { resourceUri: "ui://picker/app.html" } } │    │
│  │  }, async () => {                                          │    │
│  │    return { content: [{ type: 'text', text: '...' }] };   │    │
│  │  })                                                         │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**关键特性**:
- ✅ 后端代理，安全性高
- ✅ 动态元数据查询
- ✅ 与 AI SDK `useChat` 无缝集成
- ⚠️ Widget 无法注册自己的工具
- ⚠️ 流式预览依赖 Widget 自己实现
- ⚠️ 手动处理 JSON-RPC 协议

---

## 数据流对比

### Three.js 示例：简洁的 SDK 流程

```
AI → MCP Server → Host 自动获取资源 → Widget 接收 toolInputs/toolInputsPartial
     ↑____________________________________________↓
               Widget 调用 app.callServerTool()
```

### 我们的实现：多层代理

```
AI → Next.js API → McpRegistry → MCP Server
                                      ↓
                                 返回 HTML
                                      ↓
                              Next.js → Client
                                      ↓
                              McpWidget 创建 iframe
                                      ↓
                              Widget 接收 toolInputs
                                      ↓
Widget 调用 app.callServerTool() → AppBridge → fetch('/api/mcp/proxy')
                                                        ↓
                                              Next.js API → MCP Server
```

**观察**: 我们的流程多了 3 次网络请求：
1. 查询元数据 (`/api/mcp/tool-meta`)
2. 获取 HTML (`/api/mcp/resource`)
3. 代理工具调用 (`/api/mcp/proxy`)

**影响**: 
- 延迟增加 ~100-300ms
- 但提供了更强的安全控制和审计能力

---

## Widget 生命周期对比

### Three.js 示例

```
1. AI 调用工具
   ↓
2. Host 检测 _meta.ui.resourceUri
   ↓
3. Host 自动调用 resources/read 获取 HTML
   ↓
4. Host 渲染 iframe
   ↓
5. Widget 内 useApp() 自动连接
   ↓
6. Widget 接收 toolInputsPartial (流式)
   ↓ (AI 继续生成)
   ↓
7. Widget 接收 toolInputs (最终)
   ↓
8. Widget 执行业务逻辑
   ↓
9. (可选) Widget 调用 app.registerTool 注册的工具
   ↓
10. AI 继续对话循环
```

### 我们的实现

```
1. AI 调用工具 (mcp__server__tool)
   ↓
2. ToolRenderer 检测 mcp__ 前缀
   ↓
3. ToolRenderer 调用 /api/mcp/tool-meta
   ↓
4. (后端) 从 McpRegistry 获取工具定义
   ↓
5. (前端) 根据 resourceUri 决定渲染 McpWidget
   ↓
6. McpWidget 调用 /api/mcp/resource
   ↓
7. (后端) 通过 MCP client.readResource() 获取 HTML
   ↓
8. (前端) 创建 Blob URL，渲染 iframe
   ↓
9. McpWidget 建立 AppBridge + PostMessageTransport
   ↓
10. McpWidget 发送 sendToolInputPartial (如果 !isFinal)
   ↓
11. Widget 内 useApp() 接收 toolInputsPartial
   ↓
12. (AI 继续生成，part.input 更新)
   ↓
13. McpWidget 发送 sendToolInput (如果 isFinal)
   ↓
14. Widget 接收 toolInputs，执行最终逻辑
   ↓
15. (问题) Widget 无法注册工具，只能发送消息
```

**关键差异**:
- Three.js: Host 自动处理资源获取和流式输入
- 我们的实现: 需要手动管理每个步骤
- Three.js: Widget 可以注册工具，参与对话循环
- 我们的实现: Widget 只能被动接收输入

---

## 改进后的理想架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI Agent (Vercel AI SDK)                          │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              ToolRenderer (保持不变，统一入口)                        │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              McpWidget (增强版)                                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  ✅ 保留：后端代理架构                                       │    │
│  │  ✅ 新增：通用流式预览 UI (StreamingOverlay)                │    │
│  │  ✅ 新增：Widget 工具注册代理                                │    │
│  │     - 监听 AppBridge.onregistertool                        │    │
│  │     - 将工具元数据同步到父组件                              │    │
│  │     - AI 调用时路由到正确的 handler                         │    │
│  │  ✅ 优化：使用 @ai-sdk/mcp 客户端简化 JSON-RPC              │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**收益**:
- 保留后端代理的安全优势
- 补齐 Widget 工具注册能力
- 提供开箱即用的流式预览
- 减少样板代码，降低维护成本
