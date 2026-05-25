'use client';

import { useParams } from 'next/navigation';
import Chat from '@/components/Chat';

export default function ChatPage() {
  const params = useParams();
  const conversationId = params.id as string;
  
  return <Chat conversationId={conversationId} />;
}
