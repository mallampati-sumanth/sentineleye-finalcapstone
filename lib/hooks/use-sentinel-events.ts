'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'

export type SentinelEvent = {
  id: string
  type: string
  timestamp: number
  imageUrl?: string
  confidence?: number
  source?: string
}

type EventRow = { id: string; event_type: string; created_at: string; storage_path: string | null; confidence: number | null; source: string }

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

async function fetchEvents(): Promise<SentinelEvent[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sentinel_events')
    .select('id, event_type, created_at, storage_path, confidence, source')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error('Could not load your saved events.')

  const rows = (data ?? []) as EventRow[]
  const now = Date.now()
  const missingPaths = rows.map(row => row.storage_path).filter((path): path is string => typeof path === 'string' && (!signedUrlCache.has(path) || signedUrlCache.get(path)!.expiresAt < now + 600_000))
  if (missingPaths.length) {
    const { data: signedUrls } = await supabase.storage.from('sentinel-snapshots').createSignedUrls(missingPaths, 3600)
    for (const signed of signedUrls ?? []) {
      if (signed.path && signed.signedUrl) signedUrlCache.set(signed.path, { url: signed.signedUrl, expiresAt: now + 3_500_000 })
    }
  }
  return rows.map(row => ({
    id: row.id,
    type: row.event_type === 'person_detected' ? 'AI' : 'PIR',
    timestamp: Math.floor(new Date(row.created_at).getTime() / 1000),
    imageUrl: row.storage_path ? signedUrlCache.get(row.storage_path)?.url : undefined,
    confidence: row.confidence == null ? undefined : Number(row.confidence),
    source: row.source,
  }))
}

export function useSentinelEvents() {
  return useSWR('sentinel-events', fetchEvents, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}
