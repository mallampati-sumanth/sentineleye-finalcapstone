'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Eye, EyeOff, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

function signInErrorMessage(authError: { code?: string; status?: number }) {
  if (authError.code === 'email_not_confirmed') {
    return 'Confirm your email using the link we sent before signing in.'
  }
  if (authError.status === 429) {
    return 'Too many attempts. Wait a moment, then try again.'
  }
  if (authError.code === 'invalid_credentials') {
    return 'Invalid email or password.'
  }
  if (authError.status === 0) {
    return 'Could not reach Supabase Auth. Check the deployed Supabase URL and public anon key, then try again.'
  }

  const reference = authError.code ?? (authError.status ? `HTTP ${authError.status}` : 'unknown error')
  if (authError.status && authError.status >= 500) {
    return `Supabase Auth returned ${reference}. Check Authentication logs in your Supabase dashboard.`
  }
  return `Sign-in failed (${reference}). Check that the account exists and can sign in with email and password.`
}

export default function LoginPage() {
  const router = useRouter()
  const [confirmationError, setConfirmationError] = useState(false)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setConfirmationError(new URLSearchParams(window.location.search).get('error') === 'confirmation')
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const supabase = createClient()
    try {
      if (mode === 'signin') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
        if (authError) throw new Error(signInErrorMessage(authError))
        router.replace('/viewer')
        return
      }
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback`,
        },
      })
      if (authError) {
        if (authError.code === 'weak_password') throw new Error('Choose a stronger password and try again.')
        if (authError.status === 429) throw new Error('Too many attempts. Wait a moment, then try again.')
        throw new Error('Could not create your account. Please check your details and try again.')
      }
      if (data.session) router.replace('/viewer')
      else setMessage('Check your inbox to confirm your SentinelEye account, then sign in on each device you want to monitor.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <div className="auth-grid" aria-hidden="true" />
    <section className="auth-card">
      <div className="auth-brand"><span className="brand-mark"><Shield size={18}/></span><strong>Sentinel<span>Eye</span></strong></div>
      <div className="auth-intro"><span className="eyebrow">PRIVATE MONITORING</span><h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1><p>Sign in with the same account on your camera and remote viewer.</p></div>
      <div className="auth-tabs" role="tablist" aria-label="Account access"><button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); setMessage('') }}>Sign in</button><button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); setMessage('') }}>Create account</button></div>
      <form className="auth-form" onSubmit={submit}>
        <label className="field"><span>Email address</span><input autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
        <label className="field"><span>Password</span><span className="password-wrap"><input autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} type={showPassword ? 'text' : 'password'} minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" required /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
        {confirmationError && <p className="auth-error" role="alert">That confirmation link could not be used. Request a new one and try again.</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in securely' : 'Create account'}</button>
      </form>
      <p className="auth-footnote"><Camera size={14}/> Your event history and camera snapshots stay private to your account.</p>
    </section>
  </main>
}
