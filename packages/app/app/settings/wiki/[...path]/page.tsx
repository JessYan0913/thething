'use client';

import { useParams, useRouter } from 'next/navigation';
import WikiDetail from '@/components/WikiDetail';

// 详情页支持 category/name.md 形式的路径（catch-all 段）
export default function WikiDetailPage() {
  const params = useParams();
  const router = useRouter();
  const path = params.path as string[] | undefined;
  // 兼容两种情况：Next.js 保留 %2F（需解码）或已解码为多段（join 幂等）
  const filename = Array.isArray(path) ? decodeURIComponent(path.join('/')) : '';

  return (
    <WikiDetail
      filename={filename}
      onBack={() => router.push('/settings/wiki')}
    />
  );
}
