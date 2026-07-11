'use client';

import { useParams, useRouter } from 'next/navigation';
import McpDetail from '@/components/McpDetail';

export default function McpDetailPage() {
  const params = useParams();
  const router = useRouter();
  const serverName = params.name as string;

  return (
    <McpDetail
      serverName={serverName}
      onBack={() => router.push('/settings/mcp')}
    />
  );
}
