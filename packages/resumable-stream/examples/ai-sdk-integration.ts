/**
 * AI SDK 集成示例
 * 展示如何使用 @the-thing/resumable-stream 与 AI SDK 的 useChat 集成
 */

import { createStreamManager } from '@the-thing/resumable-stream';
import { streamText, convertToModelMessages } from 'ai';

// 创建流管理器单例
const streamManager = createStreamManager({
  database: {
    path: './ai-chat-streams.db',
    defaultTtlMs: 24 * 60 * 60 * 1000,
    cleanupIntervalMs: 60 * 60 * 1000,
  },
  autoCleanup: true,
});

// 监听事件
streamManager.onEvent((event) => {
  console.log('[Stream Event]', event);
});

/**
 * POST /api/chat - 创建聊天流（AI SDK 格式）
 *
 * 这个端点创建一个新的流，用于 AI 响应
 */
export async function POST(req: Request) {
  const { message, id: chatId } = await req.json();

  // 创建可恢复流
  const stream = streamManager.createStream({
    chatId,
    ttlMs: 60 * 60 * 1000, // 1 小时
  });

  // 使用 AI SDK 生成响应
  const result = streamText({
    model: 'openai/gpt-4o-mini',
    messages: await convertToModelMessages([message]),
  });

  // 返回 SSE 流
  const encoder = new TextEncoder();
  const responseStream = new ReadableStream({
    async start(controller) {
      try {
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

        // 完成流
        streamManager.completeStream(stream.id);
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        console.error('Stream error:', error);
        controller.error(error);
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * GET /api/chat/[chatId]/stream - 恢复聊天流
 *
 * 这个端点用于页面刷新后恢复流
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
  const url = new URL(req.url);
  const fromSequence = url.searchParams.get('from');

  // 获取活跃流
  const streams = streamManager.getActiveStreamsByChatId(chatId);
  if (streams.length === 0) {
    return new Response(null, { status: 204 });
  }

  const stream = streams[0];

  // 创建 SSE 流
  const sseStream = streamManager.createResumableSSEStream(stream.id, {
    fromSequence: fromSequence ? Number(fromSequence) : undefined,
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * POST /api/chat/[chatId]/stop - 停止聊天流
 *
 * 这个端点用于显式停止流
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;

  // 获取活跃流
  const streams = streamManager.getActiveStreamsByChatId(chatId);
  if (streams.length === 0) {
    return Response.json({ success: true });
  }

  // 停止所有活跃流
  for (const stream of streams) {
    streamManager.stopStream(stream.id);
  }

  return Response.json({ success: true });
}

/**
 * 完整的 AI SDK useChat 集成示例
 *
 * 客户端组件：
 *
 * ```tsx
 * 'use client';
 *
 * import { useChat } from '@ai-sdk/react';
 * import { DefaultChatTransport, type UIMessage } from 'ai';
 *
 * export function Chat({
 *   chatData,
 *   resume = false,
 * }: {
 *   chatData: { id: string; messages: UIMessage[] };
 *   resume?: boolean;
 * }) {
 *   const { messages, sendMessage, status } = useChat({
 *     id: chatData.id,
 *     messages: chatData.messages,
 *     resume,
 *     transport: new DefaultChatTransport({
 *       prepareSendMessagesRequest: ({ id, messages }) => {
 *         return {
 *           body: {
 *             id,
 *             message: messages[messages.length - 1],
 *           },
 *         };
 *       },
 *     }),
 *   });
 *
 *   return (
 *     <div>
 *       {messages.map((msg) => (
 *         <div key={msg.id}>{msg.content}</div>
 *       ))}
 *       <input
 *         onKeyDown={(e) => {
 *           if (e.key === 'Enter') {
 *             sendMessage({ text: e.currentTarget.value });
 *             e.currentTarget.value = '';
 *           }
 *         }}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export const useChatExample = `
// 页面组件
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

export function ChatPage({
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
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role}>
            {msg.content}
          </div>
        ))}
      </div>
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
`;
