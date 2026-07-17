# MCP App 实现对比分析

## 概述

本文档对比分析了 [Three.js MCP Server 示例](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server) 和我们项目的 MCP App 实现方案。

## 架构对比

### 官方 Three.js 示例架构

**服务端 (server.ts)**
```
MCP Server (stdio/HTTP)
  ├── Tools
  │   ├── show_threejs_scene (带 _meta.ui.resourceUri)
  │   └── learn_threejs (文档查询)
  └── Resources
      └── ui://threejs/mcp-app.html (返回打包的 HTML)
```

**客户端 (React App)**
```
mcp-app.html (入口)
  └── mcp-app-wrapper.tsx (SDK 集成)
      ├── useApp() - 连接 MCP Host
      ├── registerTool() - 注册 Widget 内工具
      ├── toolInputs/toolInputsPartial - 接收流式/最终输入
      └── threejs-app.tsx (业务逻辑)
          ├── 检测流式状态 (isStreaming)
          ├── LoadingShimmer - 显示部分代码
          └── Canvas - 渲染最终 3D 场景
```

**构建流程**
```
mcp-app.html + mcp-app-wrapper.tsx
  ↓ Vite build (vite-plugin-singlefile)
  ↓ 打包为单个 HTML 文件
  → dist/mcp-app.html (内联 CSS/JS)
```

### 我们的实现架构

**服务端 (Next.js API Routes)**
```
/api/mcp/
  ├── tool-meta (GET) - 获取工具的 _meta.ui 信息
  ├── resource (POST) - 通过 McpRegistry 读取 HTML 资源
  └── proxy (POST) - 代理 Widget 内的工具调用
```

**客户端 (React Components)**
```
ToolRenderer (统一入口)
  ├── 检测 mcp__ 前缀
  ├── useSWR 获取 _meta.ui
  └── 根据 resourceUri 决定渲染方式
      ├── 有资源 → McpWidget
      │   ├── fetch HTML from /api/mcp/resource
      │   ├── 创建 Blob URL
      │   ├── iframe sandbox 渲染
      │   ├── AppBridge + PostMessageTransport
      │   └── 代理工具调用到 /api/mcp/proxy
      └── 无资源 → 标准 Tool 组件
```

**数据流**
```
AI SDK (useChat)
  ↓ part.toolName = "mcp__serverName__toolName"
  ↓ part.input (streaming) / part.output (final)
  ↓
ToolRenderer
  ↓ GET /api/mcp/tool-meta
  ↓ POST /api/mcp/resource
  ↓
McpWidget
  ↓ AppBridge.sendToolInput(Partial/Final)
  ↓
Widget 内 (useApp)
  ↓ toolInputs / toolInputsPartial
  ↓ app.callServerTool()
  ↓
POST /api/mcp/proxy
  ↓
McpRegistry.client.callTool()
```

## 关键差异对比

### 1. 资源获取方式

| 维度 | Three.js 示例 | 我们的实现 |
|------|--------------|-----------|
| **HTML 来源** | MCP Server 的 `readResource()` | 通过 Next.js API 代理 MCP `readResource()` |
| **打包方式** | Vite 打包为单文件 HTML | Vite 打包，但由后端动态获取 |
| **缓存策略** | 客户端缓存 Blob URL | SWR 缓存元数据，每次动态获取 HTML |
| **CSP 兼容** | iframe sandbox | iframe sandbox |

**Three.js 示例**:
```typescript
// server.ts
registerAppResource(server, resourceUri, resourceUri, { mimeType: RESOURCE_MIME_TYPE },
  async (): Promise<ReadResourceResult> => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return {
      contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }]
    };
  }
);
```

**我们的实现**:
```typescript
// /api/mcp/resource/route.ts
const result = await client.readResource({ uri: resourceUri });
const htmlContent = result.contents.find(c => 
  c.mimeType?.includes('html') || c.mimeType === 'text/html;profile=mcp-app'
);
return NextResponse.json({ html: htmlContent.text });
```

### 2. 工具调用代理

| 维度 | Three.js 示例 | 我们的实现 |
|------|--------------|-----------|
| **Widget 内工具** | 通过 `app.registerTool()` 注册 | 不支持 (待补充) |
| **调用 Server 工具** | `app.callServerTool()` | AppBridge → `/api/mcp/proxy` → McpRegistry |
| **JSON-RPC 格式** | SDK 内部处理 | 手动构造 JSON-RPC 请求/响应 |
| **错误处理** | SDK 自动处理 | 手动处理，返回 error 字段 |

**Three.js 示例** (Widget 内注册工具):
```typescript
// mcp-app-wrapper.tsx
app.registerTool(
  "set-scene-source",
  {
    title: "Set Scene Source",
    inputSchema: z.object({ code: z.string(), height: z.number().optional() }),
    outputSchema: z.object({ success: z.boolean(), code: z.string() })
  },
  async (args) => {
    sceneStateRef.current.code = args.code;
    setToolInputs({ code: args.code });
    return { success: true, code: args.code };
  }
);
```

**我们的实现** (代理 Server 工具):
```typescript
// mcp-widget.tsx
const oncalltool = useCallback(async (params: any) => {
  const res = await fetch(`/api/mcp/proxy?server=${serverName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: params.name, arguments: params.arguments }
    })
  });
  return await res.json();
}, [serverName]);
```

### 3. 流式输入处理

| 维度 | Three.js 示例 | 我们的实现 |
|------|--------------|-----------|
| **检测流式状态** | `!toolInputs && !!toolInputsPartial` | `part.state === 'input-streaming'` |
| **部分输入展示** | LoadingShimmer + 自动滚动代码 | 通过 `isFinal` 参数控制 |
| **最终输入处理** | `toolInputs.code` 触发执行 | `isFinal = true` 触发 `sendToolInput` |
| **UI 反馈** | 实时预览 3D 场景构建过程 | 依赖 Widget 内实现 |

**Three.js 示例**:
```typescript
// threejs-app.tsx
const isStreaming = !toolInputs && !!toolInputsPartial;
const code = toolInputs?.code || DEFAULT_THREEJS_CODE;
const partialCode = toolInputsPartial?.code || "";

if (isStreaming || !code) {
  return <LoadingShimmer height={height} code={partialCode} />;
}

// 最终执行
executeThreeCode(code, canvasRef.current, w, h, animControllerRef.current.visibilityAwareRAF)
```

**我们的实现**:
```typescript
// mcp-widget.tsx
const isFinal = part.state === 'output-available' || 
                part.state === 'output-error' || 
                part.state === 'output-denied';

useEffect(() => {
  if (!bridge || !iframeRef.current?.contentWindow) return;
  
  if (isFinal) {
    bridge.sendToolInput(toolInput);
  } else {
    bridge.sendToolInputPartial(toolInput);
  }
}, [bridge, toolInput, isFinal]);
```

### 4. 构建和打包

| 维度 | Three.js 示例 | 我们的实现 |
|------|--------------|-----------|
| **构建工具** | Vite | Vite (假设 Widget 使用相同工具) |
| **打包插件** | `vite-plugin-singlefile` | 由 Widget 作者决定 |
| **输出格式** | 单个 HTML 文件 (CSS/JS 内联) | 单个 HTML 文件 |
| **开发模式** | Vite dev server | Vite dev server |
| **Server 模式** | stdio / StreamableHTTP | stdio (通过 AI SDK MCP) |

**Three.js 示例**:
```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    rollupOptions: { input: INPUT },
    outDir: "dist"
  }
});
```

**我们的实现**:
- 不涉及 Widget 构建，直接消费 MCP Server 提供的资源
- 需要 Widget 作者自行打包为单文件 HTML

## 核心设计对比

### 1. 职责分离

**Three.js 示例 (MCP Server 管理 UI)**
```
MCP Server
  ├── 托管 HTML 资源 (dist/mcp-app.html)
  ├── 注册工具和资源
  └── 处理工具调用

MCP Host
  ├── 读取资源
  ├── 渲染 iframe
  └── 建立 AppBridge 通信
```

**我们的实现 (Next.js 中间层)**
```
MCP Server
  ├── 托管 HTML 资源
  ├── 注册工具和资源
  └── 处理工具调用

Next.js API
  ├── /api/mcp/resource - 代理资源获取
  ├── /api/mcp/tool-meta - 提取元数据
  └── /api/mcp/proxy - 代理工具调用

React Components
  ├── ToolRenderer - 统一入口
  └── McpWidget - iframe + AppBridge
```

### 2. 安全模型

| 维度 | Three.js 示例 | 我们的实现 |
|------|--------------|-----------|
| **沙箱隔离** | iframe sandbox | iframe sandbox |
| **跨域策略** | Blob URL (同域) | Blob URL (同域) |
| **CSP 兼容** | allow-scripts, allow-same-origin | allow-scripts, allow-same-origin |
| **数据注入** | postMessage (AppBridge) | postMessage (AppBridge) |
| **工具调用权限** | Widget 可调用 Server 工具 | Widget 可调用 Server 工具 (通过代理) |

### 3. 错误处理

**Three.js 示例**:
```typescript
// threejs-app.tsx
executeThreeCode(...)
  .catch((e) => {
    const msg = e instanceof Error ? e.message : "Unknown error";
    setError(msg);
    onSceneError(msg);
  });
```

**我们的实现**:
```typescript
// mcp-widget.tsx
const fetchResource = async () => {
  try {
    const res = await fetch('/api/mcp/resource', { ... });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Failed to fetch resource');
    }
    setHtml(data.html);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Unknown error');
  }
};
```

## 优势与劣势对比

### Three.js 示例的优势
1. **简洁性**: MCP Server 直接托管和提供 UI 资源，无需中间层
2. **标准化**: 完全符合 MCP Apps 规范，使用官方 SDK
3. **可移植性**: 任何支持 MCP Apps 的 Host 都可以渲染
4. **Widget 内工具**: 支持在 Widget 内注册和调用工具
5. **开箱即用**: 提供完整的开发、构建、测试流程

### Three.js 示例的劣势
1. **资源耦合**: UI 资源必须在 MCP Server 端打包和托管
2. **更新复杂**: 更新 UI 需要重新构建和部署 Server
3. **调试困难**: iframe + postMessage 调试不便
4. **依赖 MCP Host**: 必须有支持 MCP Apps 的 Host

### 我们实现的优势
1. **灵活性**: 通过 API 层可以灵活控制资源获取和缓存
2. **集成性**: 与现有 Next.js 架构深度集成
3. **可观察性**: 可以在 API 层添加日志、监控、权限控制
4. **渐进增强**: 支持传统 Tool 和 MCP App 混合渲染
5. **动态检测**: 运行时查询 `_meta.ui`，无需静态配置

### 我们实现的劣势
1. **复杂性**: 引入额外的 API 层和状态管理
2. **性能开销**: 每次渲染都需要额外的 HTTP 请求
3. **偏离标准**: 不是纯粹的 MCP Apps 实现
4. **功能缺失**: 缺少 Widget 内工具注册、主题同步等高级特性
5. **维护成本**: 需要同步维护 API 代理层

## 功能对比矩阵

| 功能 | Three.js 示例 | 我们的实现 | 备注 |
|------|--------------|-----------|------|
| **基础渲染** | ✅ | ✅ | 两者都通过 iframe + Blob URL |
| **流式输入** | ✅ | ✅ | 检测机制不同 |
| **最终输入** | ✅ | ✅ | - |
| **调用 Server 工具** | ✅ | ✅ | 我们通过 API 代理 |
| **Widget 内注册工具** | ✅ | ❌ | 缺失：需要补充 |
| **主题同步** | ✅ | ❌ | 缺失：hostContext 未使用 |
| **样式注入** | ✅ | ❌ | 缺失：hostContext.theme 未注入 |
| **sendMessage** | ✅ | ✅ | 支持，但未充分测试 |
| **openLink** | ✅ | ❌ | 缺失：未实现 |
| **sendLog** | ✅ | ❌ | 缺失：未实现 |
| **requestDisplayMode** | ✅ | ❌ | 缺失：未实现全屏模式 |
| **postUpdate** | ✅ | ❌ | 缺失：未实现状态更新 |
| **IntersectionObserver** | ✅ | ❌ | 缺失：未实现可见性优化 |

## 改进建议

### 短期改进 (基于当前架构)

1. **补充 Widget 内工具注册**
   ```typescript
   // mcp-widget.tsx
   const onregistertool = useCallback((schema: any, handler: any) => {
     // 存储 Widget 注册的工具
     // 在 oncalltool 中优先查找本地工具
   }, []);
   
   useEffect(() => {
     const bridge = new AppBridge({
       transport: transportRef.current,
       oncalltool,
       onregistertool, // 新增
     });
   }, [oncalltool, onregistertool]);
   ```

2. **实现主题同步**
   ```typescript
   // mcp-widget.tsx
   useEffect(() => {
     if (!html || !bridge) return;
     
     const hostContext = {
       theme: {
         backgroundColor: 'var(--background)',
         textColor: 'var(--foreground)',
         // ... 其他主题变量
       }
     };
     
     let updatedHtml = html;
     updatedHtml = updatedHtml.replace(
       '</head>',
       `<style>:root { ${Object.entries(hostContext.theme).map(([k, v]) => 
         `--host-${k}: ${v};`
       ).join('')} }</style></head>`
     );
     
     const blob = new Blob([updatedHtml], { type: 'text/html' });
     setBlobUrl(URL.createObjectURL(blob));
   }, [html, bridge]);
   ```

3. **添加错误边界和重试机制**
   ```typescript
   // tool-renderer.tsx
   const { data: toolMeta, error: metaError, mutate } = useSWR(...);
   
   if (metaError) {
     return (
       <div className="error">
         <p>Failed to load MCP App metadata</p>
         <button onClick={() => mutate()}>Retry</button>
       </div>
     );
   }
   ```

4. **实现可见性优化**
   ```typescript
   // mcp-widget.tsx
   const iframeRef = useRef<HTMLIFrameElement>(null);
   
   useEffect(() => {
     const observer = new IntersectionObserver((entries) => {
       entries.forEach((entry) => {
         bridge?.postUpdate?.({ visible: entry.isIntersecting });
       });
     }, { threshold: 0.1 });
     
     if (iframeRef.current) {
       observer.observe(iframeRef.current);
     }
     
     return () => observer.disconnect();
   }, [bridge]);
   ```

### 长期改进 (架构调整)

1. **考虑实现完整的 MCP Host**
   - 直接使用 `@modelcontextprotocol/ext-apps/host` SDK
   - 移除自定义的 API 代理层
   - 更接近标准 MCP Apps 实现

2. **优化资源缓存策略**
   - 将 HTML 资源缓存到 IndexedDB
   - 使用 Service Worker 拦截请求
   - 减少网络请求次数

3. **支持多种渲染模式**
   ```typescript
   // tool-renderer.tsx
   const displayMode = toolMeta?._meta?.ui?.displayMode;
   
   return (
     <McpWidget
       displayMode={displayMode} // 'inline' | 'modal' | 'fullscreen'
       // ...
     />
   );
   ```

4. **实现开发者工具**
   - Widget 日志查看器
   - postMessage 消息监控
   - 性能分析面板

## 总结

### 选择建议

**使用 Three.js 示例风格 (推荐)如果:**
- 你在构建一个新的 MCP Host 应用
- 需要最大化可移植性和标准兼容性
- 希望 Widget 作者有完整的开发体验
- 可以接受 MCP Server 和 UI 资源的耦合

**使用我们当前的实现如果:**
- 你已经有一个成熟的 Next.js 应用
- 需要在 API 层进行权限控制和日志记录
- 希望渐进式地添加 MCP App 支持
- 需要与现有的 AI SDK 集成深度集成

### 核心差异总结

1. **架构哲学**: Three.js 示例是"MCP 原生"，我们的实现是"Next.js 集成"
2. **资源管理**: Three.js 由 Server 托管，我们通过 API 代理
3. **功能完整性**: Three.js 更完整，我们需要补充高级特性
4. **可维护性**: Three.js 更简洁，我们引入了额外复杂性

### 下一步行动

1. **补充缺失功能** (优先级从高到低)
   - [ ] Widget 内工具注册 (`onregistertool`)
   - [ ] 主题同步 (`hostContext.theme`)
   - [ ] 可见性优化 (`IntersectionObserver`)
   - [ ] 全屏模式 (`requestDisplayMode`)
   - [ ] openLink / sendLog 回调

2. **测试和验证**
   - [ ] 使用 mcp-color-picker 测试完整流程
   - [ ] 验证流式输入处理
   - [ ] 测试 Widget 内工具调用
   - [ ] 性能基准测试

3. **文档完善**
   - [ ] 更新 MCP_APP_INTEGRATION_GUIDE.md
   - [ ] 添加 Widget 开发指南
   - [ ] 补充故障排查文档

---

**参考资源**:
- [ext-apps GitHub Repository](https://github.com/modelcontextprotocol/ext-apps/)
- [ext-apps Quickstart Guide](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/quickstart.md)
- [Three.js MCP Server Example](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server)
- [MCP Apps Protocol Documentation](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/)
