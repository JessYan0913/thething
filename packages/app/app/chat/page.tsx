'use client';

import dynamic from 'next/dynamic';

const ChatHome = dynamic(() => import('@/components/ChatHome'), { ssr: false });

export default function ChatHomePage() {
  return <ChatHome />;
}
