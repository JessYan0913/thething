'use client'

import AutomationDetail from '@/components/AutomationDetail'
import { useParams, useRouter } from 'next/navigation'
import { useMemo } from 'react'

export default function AutomationDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()

  // Next.js App Router may return URL-encoded params for non-ASCII characters (e.g., Chinese)
  // Decode the id to ensure we use the correct value
  const decodedId = useMemo(() => {
    if (!params.id) return params.id
    try {
      // If the param is already decoded, decodeURIComponent will return it as-is
      // If it's encoded, it will decode it
      return decodeURIComponent(params.id)
    } catch {
      // If decoding fails, return as-is
      return params.id
    }
  }, [params.id])

  return (
    <AutomationDetail
      jobId={decodedId}
      onBack={() => router.push('/settings/automation')}
    />
  )
}
