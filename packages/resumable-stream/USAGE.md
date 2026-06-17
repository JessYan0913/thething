# 在 app 中使用 @the-thing/resumable-stream

## 步骤 1: 安装依赖

由于是 workspace 包，已经通过 `pnpm install` 自动链接。

## 步骤 2: 创建流管理器单例

在 app 中创建一个全局的流管理器实例：

```typescript
// lib/stream-manager.ts
import { createResumableStreamContextFactory, MemoryPublisher, MemorySubscriber } from '@the-thing/resumable-stream';
import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';

// 单例模式
let streamContext: ReturnType<ReturnType<typeof createResumableStreamContextFactory>> | null = null;

export function getStreamManager() {
  if (!streamContext) {
    const globalConfigDir = process.env.THETHING_GLOBAL_CONFIG_DIR || path.join(os.homedir(), '.thething');

    // 创建内存事件发射器
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);

    // 创建内存版 Publisher 和 Subscriber
    const publisher = new MemoryPublisher(emitter);
    const subscriber = new MemorySubscriber(emitter);

    // 创建上下文工厂
    const createContext = createResumableStreamContextFactory({
      subscriber: () => subscriber,
      publisher: () => publisher,
    });

    streamContext = createContext({
      waitUntil: (promise) => {
        promise.catch(console.error);
      },
      database: {
        path: path.join(globalConfigDir, 'chat-streams.db'),
        defaultTtlMs: 24 * 60 * 60 * 1000, // 24 小时
        cleanupIntervalMs: 60 * 60 * 1000, // 1 小时
      },
    });
  }

  return streamContext;
}
```

## 步骤 3: 创建 API 路由

### POST /api/chat - 创建聊天流

```typescript
// app/api/chat/route.ts
import { getStreamManager } from '@/lib/stream-manager';
import { createAgentUIStream, createUIMessageStream, createUIMessageStreamResponse } from 'ai';

export async function POST(req: Request) {
  const { message, conversationId } = await req.json();
  const streamManager = getStreamManager();

  // 创建可恢复流
  const resumableStream = await streamManager.createNewResumableStream(
    conversationId,
    () => {
      // 创建原始流：将 UIMessageChunk 对象序列化为 JSON 字符串
      const stream = new ReadableStream<string>({
        start: async (controller) => {
          try {
            // 使用 AI SDK 生成代理流
            const agentStream = await createAgentUIStream({
              agent, // 你的 agent 实例
              uiMessages: messages, // 消息数组
              sendReasoning: true,
              // ...其他配置
            });

            // 读取代理流并序列化为 JSON 字符串后发送到控制器
            const reader = agentStream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(JSON.stringify(value)); // 关键：序列化对象为字符串
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      return stream;
    }
  );

  if (!resumableStream) {
    return new Response(null, { status: 500 });
  }

  // 包装成 UI 消息流
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // 读取可恢复流（JSON 字符串）并解析为 UIMessageChunk 后写入 UI 流
      const reader = resumableStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(JSON.parse(value)); // 关键：反序列化字符串为对象
      }
    },
    onError: (err) => String(err),
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      'X-Conversation-Id': conversationId,
      'X-Stream-Id': conversationId,
    },
  });
}
```

### GET /api/chat/[chatId]/stream - 恢复聊天流

```typescript
// app/api/chat/[chatId]/stream/route.ts
import { getStreamManager } from '@/lib/stream-manager';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
  const url = new URL(req.url);
  const skipCharacters = url.searchParams.get('skip');
  const skipChunks = url.searchParams.get('skipChunks');
  const streamManager = getStreamManager();

  // 尝试恢复流（优先使用 skipChunks）
  const resumedStream = await streamManager.resumeExistingStream(
    chatId,
    skipCharacters ? Number(skipCharacters) : undefined,
    skipChunks ? Number(skipChunks) : undefined
  );

  // 如果流不存在，返回 204 No Content
  if (resumedStream === undefined) {
    return new Response(null, { status: 204 });
  }

  // 如果流已完成，返回 204 No Content
  if (resumedStream === null) {
    return new Response(null, { status: 204 });
  }

  // 将流转换为 SSE 格式
  const encoder = new TextEncoder();
  const sseStream = new ReadableStream({
    start: async (controller) => {
      try {
        const reader = resumedStream.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // 发送数据块（每个 JSON 字符串独立作为一行）
          controller.enqueue(encoder.encode(`data: ${value}\n\n`));
        }

        // 发送完成信号
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', errorText: err.message })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e) {
          // 流可能已关闭
        }
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### POST /api/chat/[chatId]/stop - 停止聊天流

```typescript
// app/api/chat/[chatId]/stop/route.ts
import { getStreamManager } from '@/lib/stream-manager';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
  const streamManager = getStreamManager();

  // 只有流仍在进行中时才停止
  const existing = await streamManager.hasExistingStream(chatId);
  if (existing === true) {
    await streamManager.stopStream(chatId);
  }

  return Response.json({ success: true });
}
```

## 步骤 4: 与 AI SDK 集成

如果你想与 AI SDK 的 `useChat` 集成，可以使用 `DefaultChatTransport`：

```typescript
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
      prepareReconnectToStreamRequest: ({ id }) => {
        return {
          api: `/api/chat/${id}/stream`,
          credentials: 'include',
        };
      },
    }),
  });

  return <div>{/* 聊天 UI */}</div>;
}
```

## 注意事项

1. **数据格式**：流中的数据块必须是字符串格式。如果使用对象流，需要先序列化为 JSON 字符串，恢复后再解析回来。
2. **独立传输**：每个数据块会独立传输，确保恢复时每个数据块都可以独立解析（例如作为 SSE 的 `data:` 行）。
3. **流恢复**：使用 `skipChunks` 参数可以跳过已接收的 chunk 数，避免重复内容。优先使用 `skipChunks`，`skipCharacters` 已弃用（因为按字符跳过可能会切开 JSON 字符串）。
4. **流停止**：使用 `stopStream` 方法可以停止正在运行的流，会触发 abort 信号，通知所有监听者流已完成。
5. **数据库路径**：确保数据库文件路径可写，建议放在全局配置目录下（如 `~/.thething/`）。
6. **并发控制**：SQLite 是单写多读，适合个人应用。
7. **流过期**：默认 24 小时过期，可通过 `defaultTtlMs` 配置。
8. **清理机制**：自动清理过期流，可通过 `cleanupIntervalMs` 配置。
