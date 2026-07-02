import Chat from "@/components/Chat";
import { useChatContext } from "./ChatLayout";
import { useParams, useSearchParams } from "next/navigation";

export default function ChatPage() {
  const { handleRefreshConversations } = useChatContext();
  const params = useParams<{ chatId?: string }>();
  const searchParams = useSearchParams();
  const conversationId = params?.chatId ? decodeURIComponent(params.chatId as string) : null;
  const initialMessage = searchParams.get("msg") || undefined;

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
    />
  );
}