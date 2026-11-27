'use client'

import { createBrowserClient } from '@supabase/ssr'
import { supabaseKey, supabaseUrl } from '@/lib/supabase/config'

let browserClient: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  browserClient ??= createBrowserClient(
    supabaseUrl,
    supabaseKey,
    { cookieOptions: { secure: process.env.NODE_ENV === 'production' } },
  )
  return browserClient
}
