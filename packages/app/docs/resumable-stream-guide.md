# Resumable Stream 使用指南

本文档说明如何在 TheThing 应用中使用 `@the-thing/resumable-stream` 包实现聊天流恢复功能。

## 功能概述

流恢复功能允许用户在页面刷新后继续接收正在进行的 AI 响应，无需等待重新生成。

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    客户端 (useChat)                      │
│  - resume: true 启用流恢复                              │
│  - 自动重连活跃流                                       │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   API 层 (Next.js)                      │
│  - POST /api/chat: 创建流                               │
│  - GET /api/chat/[chatId]/stream: 恢复流                │
│  - POST /api/chat/[chatId]/stop: 停止流                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              SQLite + 内存 Pub/Sub                      │
│  - 流数据持久化                                         │
│  - 实时广播给监听者                                     │
└─────────────────────────────────────────────────────────┘
```

## 已实现的功能

### 1. 流管理器单例

文件：`lib/stream-manager.ts`

```typescript
import { getStreamManager } from '@/lib/stream-manager';

// 获取流管理器实例
const streamManager = getStreamManager();

// 创建可恢复流
const stream = streamManager.createStream({
  chatId: conversationId,
  ttlMs: 60 * 60 * 1000, // 1 小时
});

// 添加数据块
streamManager.addChunk(stream.id, {
  type: 'text',
  data: chunk,
  timestamp: Date.now(),
});

// 完成流
streamManager.completeStream(stream.id);
```

### 2. API 端点

#### POST /api/chat
创建聊天流并返回流式响应。

#### GET /api/chat/[chatId]/stream
恢复聊天流，支持增量恢复。

**查询参数：**
- `from`: 从指定序号开始恢复（可选）

**返回：**
- 200: SSE 流数据
- 204: 没有活跃流

#### POST /api/chat/[chatId]/stop
停止聊天流。

### 3. 客户端集成

在 `Chat.tsx` 组件中已集成：

```tsx
const { messages, sendMessage, status } = useChat({
  id: conversationId,
  transport,
  resume: true, // 启用流恢复
  // ...
});
```

## 使用场景

### 场景 1: 页面刷新恢复

1. 用户发送消息，AI 开始生成响应
2. 用户刷新页面
3. 页面重新加载后，`useChat` 自动检测活跃流
4. 调用 `/api/chat/[chatId]/stream` 恢复流
5. 继续接收未完成的响应

### 场景 2: 多标签页支持

1. 用户在标签页 A 发送消息
2. 用户打开标签页 B，访问同一聊天
3. 标签页 B 可以恢复标签页 A 的流
4. 两个标签页都能接收相同的响应

### 场景 3: 网络断开恢复

1. 用户发送消息，AI 开始生成响应
2. 网络断开，连接丢失
3. 网络恢复后，`useChat` 自动重连
4. 从断点继续接收响应

## 流状态管理

### 流状态

- `active`: 流正在进行中
- `completed`: 流已完成
- `stopped`: 流被显式停止
- `expired`: 流已过期

### 流生命周期

```
创建 → 添加数据块 → 完成/停止 → 清理
 │         │            │          │
 │         │            │          └─ 自动清理过期流
 │         │            └─ 标记流状态
 │         └─ 广播给所有监听者
 └─ 存储到 SQLite
```

## 配置选项

### 流管理器配置

```typescript
const streamManager = createStreamManager({
  database: {
    path: './chat-streams.db',  // SQLite 文件路径
    defaultTtlMs: 24 * 60 * 60 * 1000,  // 默认 24 小时过期
    cleanupIntervalMs: 60 * 60 * 1000,  // 每小时清理
  },
  autoCleanup: true,  // 自动清理过期流
  logger: console.log,  // 日志函数
});
```

### 客户端配置

```tsx
useChat({
  id: conversationId,
  resume: true,  // 启用流恢复
  transport: new DefaultChatTransport({
    prepareReconnectToStreamRequest: ({ id }) => {
      return {
        api: `/api/chat/${id}/stream`,
        credentials: 'include',
      };
    },
  }),
});
```

## 性能考虑

### SQLite 优化

- 使用索引加速查询
- 定期清理过期流
- WAL 模式提高并发性能

### 内存优化

- 只在需要时缓冲数据
- 流完成后释放内存
- 限制最大监听者数量

## 故障排除

### 问题：流无法恢复

**可能原因：**
1. 流已过期（默认 24 小时）
2. 流已被标记为完成
3. 数据库文件损坏

**解决方案：**
1. 检查流状态：`streamManager.getStream(streamId)`
2. 手动清理：`streamManager.cleanup()`
3. 重建数据库：删除 `.db` 文件并重启

### 问题：多客户端不同步

**可能原因：**
1. 内存 Pub/Sub 延迟
2. 网络延迟

**解决方案：**
1. 检查事件监听：`streamManager.onEvent(console.log)`
2. 增加重试机制

## 测试

运行测试验证功能：

```bash
cd packages/resumable-stream
npx tsx test/test.ts
```

## 相关文件

- `packages/resumable-stream/` - 流管理包
- `packages/app/lib/stream-manager.ts` - 流管理器单例
- `packages/app/app/api/chat/route.ts` - 聊天 API
- `packages/app/app/api/chat/[chatId]/stream/route.ts` - 流恢复 API
- `packages/app/app/api/chat/[chatId]/stop/route.ts` - 停止流 API
- `packages/app/components/Chat.tsx` - 客户端组件
