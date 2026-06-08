'use client';

import dynamic from 'next/dynamic';

const DocPreviewLayout = dynamic(
  () => import('@/components/doc-preview/DocPreviewLayout'),
  { ssr: false }
);

export default function DocPreviewPage() {
  return <DocPreviewLayout />;
}
