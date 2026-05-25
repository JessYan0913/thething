'use client';

import { useParams } from 'next/navigation';
import AgentWorkbench from '@/components/AgentWorkbench';

export default function AgentWorkbenchPage() {
  const params = useParams();
  const agentType = params.agentType as string;
  
  return <AgentWorkbench agentType={agentType} />;
}
