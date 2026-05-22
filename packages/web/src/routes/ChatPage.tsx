import Chat from "@/components/Chat";
import { useChatContext } from "./ChatLayout";
import { useLocation } from "react-router-dom";

export default function ChatPage() {
  const { activeConversationId, handleRefreshConversations } = useChatContext();
  const location = useLocation();
  const initialMessage = (location.state as { initialMessage?: string })?.initialMessage;

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