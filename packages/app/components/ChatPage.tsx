import Chat from "@/components/Chat";
import { useChatContext } from "./ChatLayout";
import { useSearchParams } from "next/navigation";

export default function ChatPage() {
  const { activeConversationId, handleRefreshConversations } = useChatContext();
  const searchParams = useSearchParams();
  const initialMessage = searchParams.get("msg") || undefined;

  if (!activeConversationId) {
    return null; // Should not happen on /:id route, but safety check
  }

  return (
    <Chat
      key={activeConversationId}
      conversationId={activeConversationId}
      onTitleUpdated={handleRefreshConversations}
      initialMessage={initialMessage}
    />
  );
}