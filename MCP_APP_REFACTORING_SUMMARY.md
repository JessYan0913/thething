# MCP App 重构实施总结

## 日期: 2026-07-17

## 实施的改进

基于对 Three.js MCP Server 示例的深度分析，已完成以下重构：

### ✅ P0: Widget 内工具注册支持

**文件**: `packages/app/components/mcp-widget.tsx`

**改动**:
1. 添加 `widgetToolsRef` 存储 Widget 注册的工具
2. 拦截 `app.registerTool()` 调用，记录工具元数据
3. 修改 `oncalltool` 回调，添加路由逻辑:
   - 检查工具名是否为 Widget 工具
   - 如果是，本地执行 handler
   - 否则，代理到 MCP Server (`/api/mcp/proxy`)

**代码变更**:
```typescript
// 存储 Widget 工具
const widgetToolsRef = useRef<Map<string, WidgetTool>>(new Map());

// 拦截注册
bridge.app.registerTool = (name: string, schema: any, handler: any) => {
  widgetToolsRef.current.set(name, { name, schema, handler });
  return originalRegisterTool(name, schema, handler);
};

// 路由工具调用
const widgetTool = widgetToolsRef.current.get(name);
if (widgetTool) {
  // 本地执行
  const result = await widgetTool.handler(args || {});
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
// 否则代理到 Server
```

**收益**:
- ✅ Widget 可以注册自己的工具给 AI 调用
- ✅ 支持 Widget ↔ AI 的双向交互
- ✅ 实现渐进式交互（例如：颜色选择器可以注册"调整饱和度"工具）

---

### ✅ P1: 流式输入预览

**新文件**: `packages/app/components/streaming-preview.tsx`

**功能**:
1. 显示正在生成的工具输入（支持 `code` 字段和 JSON）
2. 自动滚动到底部
3. 脉冲动画背景和加载指示器
4. 光标效果

**样式**: `packages/app/app/globals.css`
```css
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.animate-shimmer {
  animation: shimmer 2s infinite;
}
```

**集成**: `packages/app/components/tool-renderer.tsx`
```typescript
const isStreaming = part.state === 'input-streaming';

{isStreaming && part.input && (
  <StreamingPreview
    input={part.input}
    toolName={baseToolName || 'tool'}
    className="mb-4"
  />
)}
```

**收益**:
- ✅ 用户实时看到 AI 生成的输入
- ✅ 减少"卡住"的感觉
- ✅ 所有 MCP App 自动获得一致的加载体验

---

### ✅ P2: TypeScript 类型优化

**新文件**: `packages/app/types/mcp.ts`

**定义的类型**:
- `McpToolMeta` - 工具元数据结构
- `WidgetTool` - Widget 工具注册接口
- `ToolCallParams` - 工具调用参数
- `ToolCallResult` - 工具调用结果
- `McpWidgetProps` - Widget 组件属性
- `StreamingPreviewProps` - 预览组件属性
- `ToolState` - 工具状态枚举
- `McpToolPart` - 扩展的 tool part 类型

**更新的文件**:
- `mcp-widget.tsx` - 导入 `McpWidgetProps`, `WidgetTool`
- `streaming-preview.tsx` - 导入 `StreamingPreviewProps`

**收益**:
- ✅ 更好的类型检查和 IDE 提示
- ✅ 集中管理 MCP 相关类型
- ✅ 便于未来扩展和重构

---

## 架构改进对比

### Before (旧实现)
```
Widget 调用工具
  ↓
AppBridge.oncalltool
  ↓
fetch('/api/mcp/proxy?server=...')
  ↓
MCP Server 执行
  ↓
返回结果
```

**限制**: Widget 无法注册自己的工具，只能被动接收输入。

### After (新实现)
```
Widget 调用工具
  ↓
AppBridge.oncalltool
  ↓
检查 widgetToolsRef
  ├─ Widget 工具? → 本地执行 handler
  └─ Server 工具? → fetch('/api/mcp/proxy')
  ↓
返回结果
```

**优势**: Widget 可以暴露自己的能力，实现双向交互。

---

## 测试计划

### 1. Widget 工具注册测试

**场景**: Color Picker Widget 注册 `adjust-saturation` 工具

**步骤**:
1. 在 Widget 内调用 `app.registerTool('adjust-saturation', schema, handler)`
2. AI 调用 `adjust-saturation` 工具
3. 验证 handler 被执行
4. 验证结果返回给 AI

**预期**: 工具成功注册并执行，AI 收到结果。

### 2. 流式预览测试

**场景**: AI 生成 Three.js 代码时显示预览

**步骤**:
1. 触发 `show_threejs_scene` 工具
2. 观察流式输入状态（`input-streaming`）
3. 验证 `StreamingPreview` 组件显示
4. 验证代码逐步显示并自动滚动
5. 验证完成后切换到最终渲染

**预期**: 用户看到实时代码生成过程。

### 3. 类型检查测试

**步骤**:
```bash
cd packages/app
pnpm run type-check
```

**预期**: 无类型错误。

---

## 待完成的工作

### P2 (中优先级)

1. **简化工具调用代理** - 使用 `@ai-sdk/mcp` 的客户端能力
2. **添加错误处理和重试** - 工具调用失败时的重试逻辑
3. **添加日志和监控** - 记录工具调用的性能和错误

### P3 (低优先级)

1. **资源缓存优化** - 添加 HTTP 缓存头和 SWR 策略
2. **Blob URL 管理** - 优化内存使用，及时清理
3. **E2E 测试** - 完整的用户流程测试

---

## 文件变更清单

### 修改的文件
- ✅ `packages/app/components/mcp-widget.tsx` - 添加工具注册和路由
- ✅ `packages/app/components/tool-renderer.tsx` - 集成流式预览
- ✅ `packages/app/app/globals.css` - 添加 shimmer 动画

### 新增的文件
- ✅ `packages/app/components/streaming-preview.tsx` - 流式预览组件
- ✅ `packages/app/types/mcp.ts` - MCP 类型定义

### 文档
- ✅ `MCP_APP_COMPARISON.md` - 详细技术对比
- ✅ `MCP_APP_ANALYSIS_SUMMARY.md` - 执行摘要
- ✅ `MCP_APP_ARCHITECTURE_COMPARISON.md` - 架构流程图
- ✅ `MCP_APP_IMPROVEMENT_GUIDE.md` - 代码改进方案
- ✅ `MCP_APP_REFACTORING_SUMMARY.md` - 本文档

---

## 参考资料

- [Three.js MCP Server 示例](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server)
- [MCP Apps 文档](https://github.com/modelcontextprotocol/ext-apps)
- [AppBridge API 文档](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/app-bridge.md)

---

## 下一步

1. **等待构建完成**，验证无编译错误
2. **运行开发服务器**，测试流式预览效果
3. **测试 Widget 工具注册**，使用 Color Picker 示例
4. **收集反馈**，根据实际使用情况调整
5. **实施 P2 优先级任务**，继续改进

---

**状态**: ✅ P0 和 P1 已完成，等待测试验证
