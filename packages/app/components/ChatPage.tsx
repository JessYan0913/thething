'use client';

import { useEffect, useState } from "react";
import Chat from "@/components/Chat";
import { useChatContext } from "./ChatLayout";
import { useParams, useSearchParams } from "next/navigation";

export default function ChatPage() {
  const { handleRefreshConversations } = useChatContext();
  const params = useParams<{ projectId?: string; source?: string; chatId?: string }>();
  const searchParams = useSearchParams();
  const conversationId = params?.chatId ? decodeURIComponent(params.chatId as string) : null;
  const projectId = params?.projectId;
  const initialMessage = searchParams.get("msg") || undefined;

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
    />
  );
}
