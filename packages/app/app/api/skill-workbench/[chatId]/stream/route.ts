/**
 * GET /api/skill-workbench/[chatId]/stream
 * 恢复聊天流 - 用于页面刷新后继续接收流式响应
 */

import { getStreamManager } from '@/lib/stream-manager';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    const url = new URL(request.url);
    const skipChunks = url.searchParams.get('skipChunks');

    const streamManager = getStreamManager();

    // 尝试恢复流
    const resumedStream = await streamManager.resumeExistingStream(
      chatId,
      undefined,
      skipChunks ? Number(skipChunks) : undefined
    );

    // 如果流不存在，返回 204 No Content
    if (resumedStream === undefined) {
      return new NextResponse(null, { status: 204 });
    }

    // 如果流已完成，返回 204 No Content
    if (resumedStream === null) {
      return new NextResponse(null, { status: 204 });
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

            // 发送数据块
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

    return new NextResponse(sseStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Skill Workbench Stream] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to resume stream' },
      { status: 500 }
    );
  }
}
