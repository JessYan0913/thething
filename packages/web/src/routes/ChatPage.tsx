import Chat from "@/components/Chat";
import { useChatContext } from "./ChatLayout";

export default function ChatPage() {
  const { activeConversationId, handleRefreshConversations } = useChatContext();

  if (!activeConversationId) {
    return null; // Should not happen on /:id route, but safety check
  }

  return (
    <Chat
      key={activeConversationId}
      conversationId={activeConversationId}
      onTitleUpdated={handleRefreshConversations}
    />
  );
}