'use client';

import { useParams, useRouter } from 'next/navigation';
import WikiDetail from '@/components/WikiDetail';

export default function WikiDetailPage() {
  const params = useParams();
  const router = useRouter();
  const filename = params.filename as string;

  return (
    <WikiDetail
      filename={decodeURIComponent(filename)}
      onBack={() => router.push('/settings/wiki')}
    />
  );
}
