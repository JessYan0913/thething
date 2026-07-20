// ============================================================
// POST /api/chat/suspended-approval-response
// Web UI 审批面板 → 后台暂停的 Agent 恢复桥接端点
// ============================================================
// 背景：
//   后台 connector 运行的 Agent 遇审批暂停时，Web UI 打开会话
//   无法通过 AI SDK 流式协议恢复（无活跃 stream）。
// 此端点提供 REST 方式提交审批结果并恢复执行。
//
// 流程：
//   1. 加载 SQLite 中的 SuspendedAgentState
//   2. 在挂起消息后追加 tool-approval-response
//   3. 重新创建 Agent（full-trust 模式），执行一轮 stream
//   4. 保存输出消息，清理挂起状态
//   5. 返回更新后的消息列表

import { getServerRuntime, getServerContext, getModelConfig } from '@/lib/runtime';
import { createAgent, finalizeAgentRun } from '@the-thing/core';
import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { conversationId, approved } = body;

    if (!conversationId) {
      return NextResponse.json({ success: false, error: 'Missing conversationId' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const store = rt.dataStore;

    // 1. 加载 SQLite 中的挂起状态
    const suspendedRow = store.suspendedStateStore.getSuspendedState(conversationId);
    if (!suspendedRow) {
      return NextResponse.json({ success: false, error: 'No suspended state found for this conversation' }, { status: 404 });
    }

    const suspended = JSON.parse(suspendedRow.state);
    const existingMessages = store.messageStore.getMessagesByConversation(conversationId);

    if (approved) {
      // ── 批准：恢复 Agent 执行 ──

      // 2a. 保存审批回复为用户消息（供对话历史展示）
      const approvalReplyMsg = {
        id: nanoid(),
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: '用户已批准工具操作' }],
      };
      const uiMessagesForSave = [...existingMessages, approvalReplyMsg];
      store.messageStore.appendMessages(conversationId, [approvalReplyMsg]);

      // 3a. 构建恢复用 ModelMessages：挂起消息 + approval-response
      const resumeModelMessages = [
        ...(suspended.pausedModelMessages as Array<{ role: string; content: unknown }>),
        {
          role: 'tool',
          content: (suspended.pendingApprovals as Array<{ approvalId: string }>).map(
            (a: { approvalId: string }) => ({
              type: 'tool-approval-response' as const,
              approvalId: a.approvalId,
              approved: true,
            }),
          ),
        },
      ];

      // 4a. 创建 Agent
      const context = await getServerContext();
      const { agent, sessionState, model, dispose, mcpRegistry, wikiBaseDir } = await createAgent({
        context,
        conversationId,
        messages: uiMessagesForSave,
        userId: 'web-ui',
        model: {
          ...getModelConfig(),
          includeUsage: true,
        },
        // 用户已通过 Web UI 面板明确批准，恢复时使用 full-trust 避免连环询问
        approvalMode: 'full-trust',
        agentRunStore: store.agentRunStore,
        conversationMeta: {
          isNewConversation: false,
          conversationStartTime: Date.now(),
          sessionSource: 'user',
        },
      });

      // 清理挂起状态（恢复执行前）
      store.suspendedStateStore.clearSuspendedState(conversationId);
      store.agentRunStore.resumeFromApproval(conversationId);

      // 5a. 执行恢复流
      let responseText = '';
      let hasReApproval = false;
      const approvedIds = new Set(
        (suspended.pendingApprovals as Array<{ approvalId: string }>).map(
          (a: { approvalId: string }) => a.approvalId,
        ),
      );

      const streamResult = await agent.stream({ messages: resumeModelMessages });

      for await (const part of streamResult.stream as AsyncIterable<{
        type: string;
        text?: string;
        approvalId?: string;
      }>) {
        if (part.type === 'text-delta') {
          responseText += part.text || '';
        }
        // 检查是否有新的审批请求（之前未见过的 approvalId）
        if (part.type === 'tool-approval-request' && part.approvalId && !approvedIds.has(part.approvalId)) {
          hasReApproval = true;
        }
      }

      const finishReason = await (streamResult as { finishReason: Promise<string> }).finishReason;
      const steps = await (streamResult as { steps: Promise<unknown[]> }).steps;

      // 没有文本输出时使用 finishReason 兜底
      if (!responseText) {
        if (hasReApproval) {
          responseText = '部分操作需要进一步审批';
        } else {
          responseText = finishReason === 'stop' ? '任务已完成' : '执行完毕';
        }
      }

      // 6a. 保存结果消息
      const assistantMsg = {
        id: nanoid(),
        role: 'assistant' as const,
        parts: [
          ...(hasReApproval
            ? [{ type: 'text' as const, text: responseText + '\n\n> ⏳ 部分操作需要进一步审批，请查看下方待审批项。' }]
            : [{ type: 'text' as const, text: responseText }]),
        ],
      };

      const messagesToSave = [...uiMessagesForSave, assistantMsg];
      store.messageStore.appendMessages(conversationId, [assistantMsg]);

      // 7a. 收尾：成本持久化 + 标题生成 + MCP 断开
      store.agentRunStore.completeRun(conversationId);

      await finalizeAgentRun({
        dataStore: store,
        messages: messagesToSave,
        conversationId,
        costTracker: sessionState.costTracker,
        mcpRegistry,
        model,
        isNewConversation: false,
        userId: 'web-ui',
        wikiBaseDir,
      }).catch((err: unknown) =>
        console.error('[SuspendedApprove] finalizeAgentRun:', err),
      );

      await dispose().catch((err: unknown) =>
        console.error('[SuspendedApprove] dispose:', err),
      );

      // 8a. 返回更新后的消息列表
      const updatedMessages = store.messageStore.getMessagesByConversation(conversationId);

      console.log(
        `[SuspendedApprove] OK: conversation=${conversationId} duration=${Date.now() - startTime}ms`,
      );

      return NextResponse.json({
        success: true,
        messages: updatedMessages,
        hasReApproval,
        duration: Date.now() - startTime,
      });
    } else {
      // ── 拒绝：取消操作，不恢复 Agent ──
      const denyMsg = {
        id: nanoid(),
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: '用户已拒绝工具操作' }],
      };
      store.messageStore.appendMessages(conversationId, [denyMsg]);

      store.suspendedStateStore.clearSuspendedState(conversationId);
      store.agentRunStore.resumeFromApproval(conversationId);
      store.agentRunStore.completeRun(conversationId);

      console.log(
        `[SuspendedApprove] DENY: conversation=${conversationId}`,
      );

      return NextResponse.json({ success: true });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SuspendedApprove] Error:', error);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
