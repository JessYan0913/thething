/**
 * GET /api/chat/[chatId]/stream
 * 恢复聊天流 - 用于页面刷新后继续接收流式响应
 * 当内存中的流不可用时，回退到 SQLite 持久化的 chunks 进行重播
 */

import { getStreamManager } from '@/lib/stream-manager';
import { getServerRuntime } from '@/lib/runtime';
import { SQLiteAgentStateStore } from '@the-thing/core';
import type { SQLiteDataStore } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const sseHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    const url = new URL(request.url);
    const skipChunks = url.searchParams.get('skipChunks');

    const streamManager = getStreamManager();

    // 尝试从内存恢复流
    const resumedStream = await streamManager.resumeExistingStream(
      chatId,
      undefined,
      skipChunks ? Number(skipChunks) : undefined
    );

    // 内存中有活跃流，直接重播
    if (resumedStream !== undefined && resumedStream !== null) {
      const encoder = new TextEncoder();
      const sseStream = new ReadableStream({
        start: async (controller) => {
          try {
            const reader = resumedStream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(encoder.encode(`data: ${value}\n\n`));
            }
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
            } catch {
              // 流可能已关闭
            }
          }
        },
      });
      return new NextResponse(sseStream, { headers: sseHeaders });
    }

    // 内存中没有流 — 检查 SQLite
    const rt = await getServerRuntime();

    // 优先检查 DurableAgent state
    try {
      const stateStore = new SQLiteAgentStateStore((rt.dataStore as unknown as SQLiteDataStore).db);
      const agentState = stateStore.getState(chatId);

      if (agentState?.status === 'timed_out' && agentState.modelMessages.length > 0) {
        const run = rt.dataStore.agentRunStore.getRun(chatId);
        if (run) {
          const chunks = rt.dataStore.agentRunStore.getChunks(chatId);
          if (chunks.length > 0) {
            console.log(`[Stream API] Replaying ${chunks.length} chunks (timed_out) for ${chatId}`);
            const encoder = new TextEncoder();
            const replayStream = new ReadableStream({
              start(controller) {
                for (const chunk of chunks) {
                  controller.enqueue(encoder.encode(`data: ${chunk.chunkData}\n\n`));
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'resume-available',
                  stepCount: agentState.stepCount,
                  message: 'Execution paused. Send a new message to continue.',
                })}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              },
            });
            return new NextResponse(replayStream, { headers: sseHeaders });
          }
        }
      }

      if (agentState?.status === 'awaiting_approval') {
        const run = rt.dataStore.agentRunStore.getRun(chatId);
        if (run) {
          const chunks = rt.dataStore.agentRunStore.getChunks(chatId);
          if (chunks.length > 0) {
            console.log(`[Stream API] Replaying ${chunks.length} chunks (awaiting_approval) for ${chatId}`);
            const encoder = new TextEncoder();
            const replayStream = new ReadableStream({
              start(controller) {
                for (const chunk of chunks) {
                  controller.enqueue(encoder.encode(`data: ${chunk.chunkData}\n\n`));
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'approval-needed',
                  message: 'Agent is waiting for tool approval.',
                })}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              },
            });
            return new NextResponse(replayStream, { headers: sseHeaders });
          }
        }
      }
    } catch {
      // workflow 表可能不存在，忽略
    }

    // 回退到旧的 agent_runs 系统
    const run = rt.dataStore.agentRunStore.getRun(chatId);

    if (run?.status === 'running') {
      // 进程重启后，running 状态是陈旧数据，静默标记为 failed
      console.log(`[Stream API] Stale running state for ${chatId}, marking as failed`);
      rt.dataStore.agentRunStore.failRun(chatId, 'Process restarted');
      rt.dataStore.agentRunStore.clearChunks(chatId);
    }

    // 没有可恢复的数据
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[Stream API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to resume stream' },
      { status: 500 }
    );
  }
}
