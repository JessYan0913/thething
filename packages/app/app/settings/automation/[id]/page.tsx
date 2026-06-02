'use client'

import AutomationExecutions from '@/components/AutomationExecutions'
import { useParams } from 'next/navigation'

export default function AutomationExecutionsPage() {
  const params = useParams<{ id: string }>()
  return <AutomationExecutions jobId={params.id} />
}
