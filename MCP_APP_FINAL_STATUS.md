# MCP App 架构重构 - 最终方案

## 决策: 删除 ToolRenderer，直接在 Chat 中实现 ✅

### 理由

1. **YAGNI 原则** - ToolRenderer 从未被使用，是过早抽象
2. **简单优于复杂** - 减少一个抽象层，代码更清晰
3. **符合实际** - Chat.tsx 是唯一需要渲染工具的地方

---

## 当前状态

### ✅ 已完成的改进

1. **Widget 工具注册** (P0)
   - ✅ McpWidget 支持工具路由（Widget 工具 vs Server 工具）
   - ✅ 拦截 `app.registerTool()` 调用
   - 文件: `packages/app/components/mcp-widget.tsx`

2. **流式预览组件** (P1)
   - ✅ StreamingPreview 组件创建
   - ✅ shimmer 动画添加
   - 文件: `packages/app/components/streaming-preview.tsx`, `app/globals.css`

3. **TypeScript 类型优化** (P2)
   - ✅ MCP 类型定义集中管理
   - 文件: `packages/app/types/mcp.ts`

### ✅ 已删除的文件

- ❌ `packages/app/components/tool-renderer.tsx` - 未使用的抽象层

---

## 待实施: 在 Chat.tsx 中添加工具渲染

### 原因

目前 **Chat.tsx 不渲染 message.parts**，所以即使有 McpWidget，也没有地方使用它。

### 需要的改动

```typescript
// packages/app/components/Chat.tsx

// 1. 添加导入
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import { McpWidget } from '@/components/mcp-widget';
import { StreamingPreview } from '@/components/streaming-preview';
import useSWR from 'swr';

// 2. 在消息渲染中添加 parts 处理
{message.parts?.map((part, index) => {
  // 检测 MCP 工具
  const isMcpTool = part.type === 'dynamic-tool' && part.toolName?.startsWith('mcp__');
  
  if (isMcpTool) {
    const [, serverName, baseToolName] = part.toolName.split('__');
    
    // 获取工具元数据
    const { data: toolMeta } = useSWR(
      `/api/mcp/tool-meta?name=${baseToolName}&server=${serverName}`,
      fetcher,
      { revalidateOnFocus: false, dedupingInterval: 60000 }
    );
    
    const resourceUri = toolMeta?._meta?.ui?.resourceUri;
    
    if (resourceUri) {
      // MCP App 渲染
      const isFinal = part.state === 'output-available' || 
                      part.state === 'output-error' || 
                      part.state === 'output-denied';
      const isStreaming = part.state === 'input-streaming';
      
      return (
        <Tool key={index} defaultOpen>
          <ToolHeader type={part.type} state={part.state} toolName={part.toolName} title={baseToolName} />
          <ToolContent>
            {isStreaming && part.input && (
              <StreamingPreview input={part.input} toolName={baseToolName} className="mb-4" />
            )}
            <McpWidget
              resourceUri={resourceUri}
              serverName={serverName}
              toolInput={part.input || {}}
              isFinal={isFinal}
              toolName={baseToolName}
              onSendMessage={handleSendMessage}
            />
          </ToolContent>
        </Tool>
      );
    }
  }
  
  // 标准工具渲染
  return (
    <Tool key={index} defaultOpen>
      <ToolHeader type={part.type} state={part.state} toolName={part.toolName} />
      <ToolContent>
        {(part.state === 'input-streaming' || part.state === 'input-available') && (
          <ToolInput input={part.input} />
        )}
        {(part.state !== 'input-streaming' && part.state !== 'input-available') && (
          <ToolOutput output={part.output} errorText={part.errorText} toolType={part.type} toolInput={part.input} />
        )}
      </ToolContent>
    </Tool>
  );
})}
```

---

## 文件清单

### 保留的文件 (5)
- ✅ `packages/app/components/mcp-widget.tsx` - MCP Widget 核心
- ✅ `packages/app/components/streaming-preview.tsx` - 流式预览
- ✅ `packages/app/types/mcp.ts` - 类型定义
- ✅ `packages/app/app/globals.css` - shimmer 动画
- ⏳ `packages/app/components/Chat.tsx` - 待添加渲染逻辑

### 删除的文件 (1)
- ❌ `packages/app/components/tool-renderer.tsx` - 未使用的抽象

---

## 架构对比

### Before (ToolRenderer 方案)
```
Chat.tsx
  └─ <ToolRenderer part={part} />
       ├─ 检测 MCP 工具
       ├─ 获取元数据
       └─ 渲染 McpWidget 或 标准 Tool
```
**问题**: 3 层抽象，ToolRenderer 从未被使用

### After (直接实现)
```
Chat.tsx
  └─ 直接渲染
       ├─ 检测 MCP 工具
       ├─ 获取元数据
       └─ 条件渲染 McpWidget 或 标准 Tool
```
**优势**: 2 层，更简单直接

---

## 下一步

1. ✅ **删除 tool-renderer.tsx** - 已完成
2. ⏳ **在 Chat.tsx 中添加 parts 渲染逻辑** - 待实施
3. ⏳ **测试 MCP App 功能** - 待验证

---

## 总结

✅ **核心功能已实现**:
- Widget 工具注册 ✅
- 流式预览组件 ✅
- 类型定义优化 ✅

⏳ **待集成到 Chat.tsx**:
- 添加 message.parts 渲染逻辑
- 条件渲染 MCP App vs 标准工具

🎯 **架构更简洁**:
- 删除未使用的 ToolRenderer
- 减少抽象层次
- 代码更易维护

---

**状态**: 核心组件完成，等待在 Chat.tsx 中集成
