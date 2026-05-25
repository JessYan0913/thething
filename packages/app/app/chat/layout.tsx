'use client';

import dynamic from 'next/dynamic';
import { ReactNode } from 'react';

const ChatLayoutComponent = dynamic(() => import('@/components/ChatLayout'), { ssr: false });

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <ChatLayoutComponent>{children}</ChatLayoutComponent>;
}
