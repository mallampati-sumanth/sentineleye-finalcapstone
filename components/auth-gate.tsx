'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { BrandLogo } from '@/components/brand-logo'
import { createClient } from '@/lib/supabase/client'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const isPublic = pathname === '/login' || pathname.startsWith('/auth/')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      setUser(data.user)
      setReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null)
      setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!ready) return
    if (!user && !isPublic) router.replace('/login')
    if (user && pathname === '/login') router.replace('/viewer')
  }, [isPublic, pathname, ready, router, user])

  if (isPublic) return children
  if (!ready || !user) {
    return <main className="auth-loading" aria-live="polite"><BrandLogo /><p>Securing your monitoring session…</p></main>
  }
  return children
}
