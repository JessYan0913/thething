'use client';

import { useParams, useRouter } from 'next/navigation';
import AgentEditor from '@/components/AgentEditor';

export default function AgentEditPage() {
  const params = useParams();
  const router = useRouter();
  const agentType = params.agentType as string;

  // "new" 表示创建新 agent
  const isCreate = agentType === 'new';

  return (
    <AgentEditor
      agentType={isCreate ? undefined : agentType}
      onBack={() => router.push('/settings/agents')}
      onSaved={() => router.push('/settings/agents')}
    />
  );
}
