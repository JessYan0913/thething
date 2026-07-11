'use client';

import { useParams, useRouter } from 'next/navigation';
import ConnectorsDetail from '@/components/ConnectorsDetail';

export default function ConnectorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const connectorId = params.id as string;

  return (
    <ConnectorsDetail
      connectorId={connectorId}
      onBack={() => router.push('/settings/connectors')}
    />
  );
}
