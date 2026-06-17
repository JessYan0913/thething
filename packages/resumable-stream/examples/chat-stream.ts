/**
 * 聊天流恢复示例
 * 展示如何在 Next.js API 路由中使用 @the-thing/resumable-stream
 */

import { createStreamManager } from '@the-thing/resumable-stream';

// 创建流管理器实例（应该在全局单例中创建）
const streamManager = createStreamManager({
  database: {
    path: './chat-streams.db',
    defaultTtlMs: 24 * 60 * 60 * 1000, // 24 小时
    cleanupIntervalMs: 60 * 60 * 1000, // 1 小时
  },
  autoCleanup: true,
  logger: console.log,
});

// 监听事件
streamManager.onEvent((event) => {
  console.log('[Stream Event]', event);
});

/**
 * POST /api/chat - 创建聊天流
 */
export async function handleCreateChat(req: Request): Promise<Response> {
  const { message, chatId } = await req.json();

  // 创建可恢复流
  const stream = streamManager.createStream({
    chatId,
    ttlMs: 60 * 60 * 1000, // 1 小时
  });

  // 模拟 AI 响应（实际应用中调用 AI SDK）
  const response = await simulateAIResponse(message);

  // 添加响应到流
  streamManager.addChunk(stream.id, {
    type: 'text',
    data: response,
    timestamp: Date.now(),
  });

  // 完成流
  streamManager.completeStream(stream.id);

  return Response.json({
    streamId: stream.id,
    chatId,
  });
}

/**
 * GET /api/chat/[chatId]/stream - 恢复聊天流
 */
export async function handleResumeChat(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
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
 */
export async function handleStopChat(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
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
 * GET /api/chat/[chatId]/status - 获取流状态
 */
export async function handleGetStreamStatus(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const { chatId } = await params;

  const streams = streamManager.getActiveStreamsByChatId(chatId);
  const stats = streamManager.getStats();

  return Response.json({
    activeStreams: streams.length,
    streams: streams.map((s) => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    })),
    stats,
  });
}

// 模拟 AI 响应
async function simulateAIResponse(message: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return `收到您的消息: "${message}"。这是模拟的 AI 响应。`;
}
