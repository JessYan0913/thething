'use client';

import { useEffect, useState } from "react";
import Chat from "@/components/Chat";
import { useChatContext } from "./ChatLayout";
import { useParams, useSearchParams } from "next/navigation";
import {
  ContextBudgetSnapshotSchema,
  type ContextBudgetSnapshot,
} from "@the-thing/core/context-budget";

/**
 * 从会话数据库行（contextUsage 等旧字段）构造新 schema 的 snapshot。
 * 阶段 2 过渡用：DB 仍是旧字段，但 Chat 接收新 schema 类型。
 * 阶段 3 切到 DB v18 新列后，本函数可改为直接读新列。
 */
function buildSnapshotFromConversation(conversation: {
  contextUsage?: number | null;
  contextTotal?: number | null;
  contextLimit?: number | null;
  contextMessages?: number | null;
  contextInstructions?: number | null;
  contextTools?: number | null;
  contextOutputReserve?: number | null;
  contextCachedReadTokens?: number | null;
  contextStepInputTokens?: number | null;
  contextLastCompactionFreedTokens?: number | null;
  contextCompacted?: boolean | null;
}): ContextBudgetSnapshot | null {
  if (conversation.contextUsage == null) return null;
  const snapshot: ContextBudgetSnapshot = {
    utilizationPercent: Math.min(100, Math.max(0, conversation.contextUsage)),
    totalTokens: conversation.contextTotal ?? 0,
    modelLimit: conversation.contextLimit ?? 128_000,
    compaction: {
      // 旧 schema 没有 compactionsCount；仅能推断"是否曾压缩过"
      state: 'idle',
      compactionsCount: conversation.contextCompacted ? 1 : 0,
      totalFreed: conversation.contextLastCompactionFreedTokens ?? 0,
      triggerPercent: 0.85,  // 旧 DB 没存；硬编码默认值
    },
    sessionCost: {
      inputTokens: 0,  // 旧 DB 缺字段；前端显示为 0
      outputTokens: 0,
      cachedReadTokens: conversation.contextCachedReadTokens ?? 0,
      totalCostUsd: 0,
    },
    capturedAt: new Date().toISOString(),
    source: 'db-loaded',
  };
  const result = ContextBudgetSnapshotSchema.safeParse(snapshot);
  return result.success ? result.data : null;
}

export default function ChatPage() {
  const { handleRefreshConversations, conversations } = useChatContext();
  const params = useParams<{ projectId?: string; source?: string; chatId?: string }>();
  const searchParams = useSearchParams();
  const conversationId = params?.chatId ? decodeURIComponent(params.chatId as string) : null;
  const projectId = params?.projectId;
  const initialMessage = searchParams.get("msg") || undefined;

  // 从会话列表中取得当前会话的上下文水位（新 schema 类型）
  const conversation = conversations.find(c => c.id === conversationId);
  const contextBudget = conversation ? buildSnapshotFromConversation(conversation) : null;

  // 根据 projectId 获取项目根路径，用于将 Agent 返回的相对路径补全为绝对路径
  const [projectPath, setProjectPath] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!projectId) {
      setProjectPath(undefined);
      return;
    }
    let cancelled = false;
    fetch('/api/projects')
      .then(res => res.json())
      .then((data: { projects: Array<{ id: string; path: string }> }) => {
        if (cancelled) return;
        const project = data.projects?.find(p => p.id === projectId);
        if (project?.path) {
          setProjectPath(project.path);
        }
      })
      .catch(err => {
        console.error('[ChatPage] Failed to fetch project path:', err);
        setProjectPath(undefined);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  // Use the URL chatId param as the source of truth instead of context's
  // activeConversationId, because there's a race condition between the
  // context state update (setActiveConversationId) and the route transition
  // (router.push) when navigating from the sidebar. Reading from the URL
  // ensures the conversation ID is always synchronized with the current route.
  if (!conversationId) {
    return null;
  }

  return (
    <Chat
      key={conversationId}
      conversationId={conversationId}
      onTitleUpdated={handleRefreshConversations}
      initialMessage={initialMessage}
      projectPath={projectPath}
      contextBudget={contextBudget}
    />
  );
}
