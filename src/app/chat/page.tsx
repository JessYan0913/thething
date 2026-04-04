import Chat from '@/components/Chat';

export default function ChatHome() {
  // No conversation ID in URL - Chat component will handle
  // redirecting to stored conversation if one exists
  return <Chat conversationId={null} />;
}
