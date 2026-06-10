'use client';

import dynamic from 'next/dynamic';

const ChatHome = dynamic(() => import('@/components/ChatHome'), { ssr: false });

export default function SourceListPage() {
  return <ChatHome />;
}
