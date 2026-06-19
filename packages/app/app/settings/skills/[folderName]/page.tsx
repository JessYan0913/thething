'use client'

import { useParams } from 'next/navigation'
import SkillDetail from '@/components/SkillDetail'

export default function SkillDetailPage() {
  const params = useParams<{ folderName: string }>()
  return <SkillDetail folderName={decodeURIComponent(params.folderName)} />
}
