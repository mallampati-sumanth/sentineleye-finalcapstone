'use client'

import useSWR from 'swr'
import { DEFAULT_ZONE } from '@/lib/sentinel'
import { createClient } from '@/lib/supabase/client'

export type SentinelSettings = {
  user_id?: string
  zone: { x: number; y: number; w: number; h: number }
  alert_cooldown_seconds: number
  recipient_email: string
  telegram_chat_id: string
  email_enabled: boolean
  telegram_enabled: boolean
  camera_peer_id?: string | null
}

export const DEFAULT_SETTINGS: SentinelSettings = {
  zone: DEFAULT_ZONE,
  alert_cooldown_seconds: 300,
  recipient_email: '',
  telegram_chat_id: '',
  email_enabled: false,
  telegram_enabled: false,
  camera_peer_id: null,
}

async function fetchSettings(): Promise<SentinelSettings> {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in to load your settings.')
  const { data, error } = await supabase
    .from('sentinel_settings')
      .select('user_id, zone, alert_cooldown_seconds, recipient_email, telegram_chat_id, email_enabled, telegram_enabled, camera_peer_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw new Error('Could not load your settings.')
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    zone: data?.zone ?? DEFAULT_ZONE,
    recipient_email: data?.recipient_email ?? '',
    telegram_chat_id: data?.telegram_chat_id ?? '',
  }
}

export async function saveSentinelSettings(settings: SentinelSettings) {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in to save your settings.')
  const { error } = await supabase.from('sentinel_settings').upsert({
    ...settings,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error('Could not save your settings. Please try again.')
}

export function useSentinelSettings() {
  return useSWR('sentinel-settings', fetchSettings, { revalidateOnFocus: true })
}
