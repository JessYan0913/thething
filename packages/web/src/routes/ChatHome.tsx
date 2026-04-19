import { ConversationEmptyState } from "@/components/ai-elements/conversation";

export default function ChatHome() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <ConversationEmptyState
        title="Start a new conversation"
        description="Click the + button in the sidebar to begin."
      />
    </div>
  );
}