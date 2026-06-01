'use client';

import { useParams, useSearchParams } from 'next/navigation';
import Chat from '@/components/Chat';

export default function ChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const conversationId = decodeURIComponent(params.id as string);
  const initialMessage = searchParams.get('msg') ?? undefined;

  return <Chat conversationId={conversationId} initialMessage={initialMessage} />;
}
