# @the-thing/resumable-stream

基于 SQLite + 内存 Pub/Sub 的可恢复流实现，适用于个人终端应用。这是 `resumable-stream` 包的轻量级替代方案，无需 Redis 依赖。

## 特性

- ✅ 基于 SQLite，无需额外服务
- ✅ 内存 Pub/Sub 机制（类似 Redis 但更轻量）
- ✅ 完整的流生命周期管理
- ✅ 支持流恢复（页面刷新后继续）
- ✅ 多客户端同时订阅同一流
- ✅ 懒缓冲策略（只在需要时缓冲）
- ✅ 自动清理过期流
- ✅ 事件系统支持
- ✅ SSE 格式支持
- ✅ TypeScript 支持
- ✅ 与 AI SDK useChat 集成

## 安装

```bash
pnpm add @the-thing/resumable-stream
```

## 快速开始

### 1. 创建流管理器

```typescript
import { createStreamManager } from '@the-thing/resumable-stream';

const streamManager = createStreamManager({
  database: {
    path: './streams.db',  // SQLite 文件路径
    defaultTtlMs: 24 * 60 * 60 * 1000,  // 24 小时过期
    cleanupIntervalMs: 60 * 60 * 1000,  // 每小时清理
  },
  autoCleanup: true,
});
```

### 2. 创建可恢复流

```typescript
// 创建新流
const stream = streamManager.createStream({
  chatId: 'chat-123',
  ttlMs: 60 * 60 * 1000,  // 1 小时过期
});

console.log('Stream ID:', stream.id);
```

### 3. 添加数据块

```typescript
// 添加文本数据块
streamManager.addChunk(stream.id, {
  type: 'text',
  data: 'Hello, world!',
  timestamp: Date.now(),
});

// 批量添加数据块
streamManager.addChunks(stream.id, [
  { type: 'text', data: 'Line 1', timestamp: Date.now() },
  { type: 'text', data: 'Line 2', timestamp: Date.now() },
  { type: 'metadata', data: { progress: 50 }, timestamp: Date.now() },
]);
```

### 4. 恢复流

```typescript
// 从头恢复
const chunks = streamManager.resumeStream(stream.id);

// 从指定位置恢复（增量恢复）
const newChunks = streamManager.resumeStream(stream.id, lastSequence);
```

### 5. 完成或停止流

```typescript
// 完成流
streamManager.completeStream(stream.id);

// 停止流
streamManager.stopStream(stream.id);
```

## API 参考

### StreamManager

#### 构造函数

```typescript
new StreamManager(options: StreamManagerOptions)
```

#### 方法

| 方法 | 描述 |
|------|------|
| `createStream(options)` | 创建新流 |
| `getStream(streamId)` | 获取流信息 |
| `getStreamData(streamId)` | 获取流数据（包含所有数据块） |
| `resumeStream(streamId, fromSequence?)` | 恢复流，返回数据块列表 |
| `addChunk(streamId, chunk)` | 添加数据块 |
| `addChunks(streamId, chunks)` | 批量添加数据块 |
| `completeStream(streamId)` | 完成流 |
| `stopStream(streamId)` | 停止流 |
| `deleteStream(streamId)` | 删除流 |
| `getActiveStreamsByChatId(chatId)` | 获取聊天的所有活跃流 |
| `cleanup()` | 手动清理过期流 |
| `getStats()` | 获取统计信息 |
| `close()` | 关闭管理器 |

### 事件系统

```typescript
// 注册事件处理器
const unsubscribe = streamManager.onEvent((event) => {
  console.log('Event:', event);
});

// 事件类型
type StreamEvent =
  | { type: 'created'; streamId: string; chatId: string }
  | { type: 'chunk_added'; streamId: string; sequence: number }
  | { type: 'completed'; streamId: string }
  | { type: 'stopped'; streamId: string }
  | { type: 'resumed'; streamId: string; fromSequence: number }
  | { type: 'expired'; streamId: string }
  | { type: 'cleaned_up'; count: number };
```

### SSE 流支持

```typescript
// 创建 SSE 格式的流
const sseStream = streamManager.createResumableSSEStream(streamId, {
  fromSequence: 0,
});

// 返回给客户端
return new Response(sseStream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  },
});
```

## 使用场景

### 1. 聊天应用流恢复

```typescript
// POST 处理器 - 创建流
app.post('/api/chat', async (req, res) => {
  const { message, chatId } = req.body;
  
  // 创建可恢复流
  const stream = streamManager.createStream({ chatId });
  
  // 生成 AI 响应并添加到流
  const response = await generateAIResponse(message);
  streamManager.addChunk(stream.id, {
    type: 'text',
    data: response,
    timestamp: Date.now(),
  });
  
  // 完成流
  streamManager.completeStream(stream.id);
  
  res.json({ streamId: stream.id });
});

// GET 处理器 - 恢复流
app.get('/api/chat/:chatId/stream', (req, res) => {
  const { chatId } = req.params;
  const { fromSequence } = req.query;
  
  // 获取活跃流
  const streams = streamManager.getActiveStreamsByChatId(chatId);
  if (streams.length === 0) {
    return res.status(204).end();
  }
  
  const stream = streams[0];
  
  // 创建 SSE 流
  const sseStream = streamManager.createResumableSSEStream(stream.id, {
    fromSequence: fromSequence ? Number(fromSequence) : undefined,
  });
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // 管道传输
  const reader = sseStream.getReader();
  const writer = res.getWriter();
  
  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        writer.close();
        break;
      }
      writer.write(value);
    }
  };
  
  pump();
});
```

### 2. 长时间任务进度追踪

```typescript
// 创建进度流
const progressStream = streamManager.createStream({
  chatId: 'task-123',
  ttlMs: 60 * 60 * 1000,
});

// 模拟长时间任务
for (let i = 0; i <= 100; i += 10) {
  streamManager.addChunk(progressStream.id, {
    type: 'metadata',
    data: { progress: i, status: 'processing' },
    timestamp: Date.now(),
  });
  
  await sleep(1000);
}

// 完成
streamManager.completeStream(progressStream.id);
```

## 与 AI SDK 集成

本包完全兼容 [AI SDK 的 chatbot-resume-streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams) 方案。

### 服务端实现

```typescript
// app/api/chat/route.ts
import { createStreamManager } from '@the-thing/resumable-stream';
import { streamText, convertToModelMessages } from 'ai';

const streamManager = createStreamManager({
  database: {
    path: './chat-streams.db',
    defaultTtlMs: 24 * 60 * 60 * 1000,
  },
});

export async function POST(req: Request) {
  const { message, id: chatId } = await req.json();
  
  // 创建可恢复流
  const stream = streamManager.createStream({ chatId });
  
  // 使用 AI SDK 生成响应
  const result = streamText({
    model: 'openai/gpt-4o-mini',
    messages: await convertToModelMessages([message]),
  });
  
  // 返回 SSE 流
  const encoder = new TextEncoder();
  const responseStream = new ReadableStream({
    async start(controller) {
      for await (const chunk of result.textStream) {
        // 存储数据块
        streamManager.addChunk(stream.id, {
          type: 'text',
          data: chunk,
          timestamp: Date.now(),
        });
        
        // 发送到客户端
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
        );
      }
      
      streamManager.completeStream(stream.id);
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  
  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
```

### 客户端实现

```tsx
// components/Chat.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

export function Chat({
  chatData,
  resume = false,
}: {
  chatData: { id: string; messages: UIMessage[] };
  resume?: boolean;
}) {
  const { messages, sendMessage, status } = useChat({
    id: chatData.id,
    messages: chatData.messages,
    resume,
    transport: new DefaultChatTransport({
      prepareSendMessagesRequest: ({ id, messages }) => {
        return {
          body: {
            id,
            message: messages[messages.length - 1],
          },
        };
      },
    }),
  });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>{msg.content}</div>
      ))}
      <input
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            sendMessage({ text: e.currentTarget.value });
            e.currentTarget.value = '';
          }
        }}
      />
    </div>
  );
}
```

## 与原 resumable-stream 的对比

| 特性 | resumable-stream (Redis) | @the-thing/resumable-stream (SQLite) |
|------|-------------------------|--------------------------------------|
| **依赖** | Redis | SQLite (嵌入式) |
| **部署** | 需要 Redis 服务 | 无需额外服务 |
| **Pub/Sub** | Redis 原生 | 内存实现 |
| **跨实例** | ✅ 支持 | ❌ 单进程 |
| **多客户端** | ✅ 支持 | ✅ 支持（内存） |
| **性能** | 高 | 中等 |
| **适合场景** | 服务器端/多用户 | 个人终端应用 |

## 许可证

MIT
