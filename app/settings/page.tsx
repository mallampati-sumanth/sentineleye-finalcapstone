'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, LogOut, Mail, Radio, Save, Send, Shield, Siren, Wifi } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { BrandLogo } from '@/components/brand-logo'
import useSWR, { mutate } from 'swr'
import { HELPER_URL, helperRequest } from '@/lib/sentinel'
import { DEFAULT_SETTINGS, saveSentinelSettings, useSentinelSettings, type SentinelSettings } from '@/lib/hooks/use-sentinel-settings'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const router = useRouter()
  const { data: savedSettings, error: settingsError, isLoading } = useSentinelSettings()
  const [config, setConfig] = useState<SentinelSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [testingNotification, setTestingNotification] = useState<'email' | 'telegram' | null>(null)
  useEffect(() => { if (savedSettings) setConfig(savedSettings) }, [savedSettings])
  const update = <K extends keyof SentinelSettings>(key: K, value: SentinelSettings[K]) => setConfig(current => ({ ...current, [key]: value }))

  const save = async () => {
    const { x, y, w, h } = config.zone
    if (![x, y, w, h].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || x + w > 1 || y + h > 1) {
      toast.error('Keep the detection zone inside the camera frame.')
      return
    }
    if (config.email_enabled && !config.recipient_email.trim()) {
      toast.error('Add an email address or turn off email alerts.')
      return
    }
    if (config.telegram_enabled && !config.telegram_chat_id.trim()) {
      toast.error('Add a Telegram chat ID or turn off Telegram alerts.')
      return
    }
    setSaving(true)
    try {
      await saveSentinelSettings({ ...config, recipient_email: config.recipient_email.trim(), telegram_chat_id: config.telegram_chat_id.trim() })
      await mutate('sentinel-settings')
      toast.success('Settings saved to your account')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  const test = async (path: string) => {
    try {
      if (path === '/status') {
        const result = await helperRequest(path)
        toast.success(result.online ? 'ESP32 is online' : 'Helper connected; waiting for ESP32')
      } else {
        await helperRequest(path, { method: 'POST', body: JSON.stringify({}) })
        toast.success('Alarm test triggered')
      }
    } catch (error) {
      const message = error instanceof Error && !/fetch failed/i.test(error.message)
        ? error.message
        : 'Hardware helper is unreachable. Check that it is running and try again.'
      toast.error(message)
    }
  }

  const testNotification = async (channel: 'email' | 'telegram') => {
    if (!savedSettings) {
      toast.error('Wait for your saved settings to load, then try again.')
      return
    }
    const matchesSavedSettings = channel === 'email'
      ? config.email_enabled === savedSettings.email_enabled && config.recipient_email.trim() === savedSettings.recipient_email
      : config.telegram_enabled === savedSettings.telegram_enabled && config.telegram_chat_id.trim() === savedSettings.telegram_chat_id
    if (!matchesSavedSettings) {
      toast.error('Save your alert settings before sending a test.')
      return
    }

    setTestingNotification(channel)
    try {
      const response = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || `Notification test failed (${response.status}).`)
      toast.success(`${channel === 'email' ? 'Email' : 'Telegram'} test notification sent`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Notification test failed.')
    } finally {
      setTestingNotification(null)
    }
  }

  const signOut = async () => {
    await createClient().auth.signOut()
    router.replace('/login')
  }

  return <main className="settings-shell"><Toaster theme="light" position="top-right"/><header className="settings-header"><Link href="/viewer" className="back-link"><ArrowLeft size={16}/> Back to monitor</Link><div className="brand"><BrandLogo /></div></header><section className="settings-content"><p className="eyebrow">ACCOUNT CONFIGURATION</p><h1>Settings</h1><p className="page-subtitle">Your detection zone and alert destinations sync across signed-in devices.</p>
    {settingsError && <div className="network-warning">Could not load account settings. Refresh and try again.</div>}
    <article className="panel settings-card"><div className="settings-section-title"><div className="health-icon cyan"><Shield size={17}/></div><div><h2>Detection & zone</h2><p>Detection runs on the camera device. Events are rate-limited across your account.</p></div></div><label className="form-label">Alert cooldown <strong>{Math.floor(config.alert_cooldown_seconds/60)}m {config.alert_cooldown_seconds%60}s</strong></label><input aria-label="Alert cooldown duration" type="range" min="30" max="600" step="30" value={config.alert_cooldown_seconds} onChange={event => update('alert_cooldown_seconds', Number(event.target.value))} className="range-input"/><div className="range-scale"><span>30 sec</span><span>10 min</span></div><div className="zone-preview"><div className="zone-room"><span>ENTRY CAM · RESTRICTED AREA</span><div className="zone-rectangle" style={{ left: `${config.zone.x * 100}%`, top: `${config.zone.y * 100}%`, width: `${config.zone.w * 100}%`, height: `${config.zone.h * 100}%` }}>DETECTION ZONE</div></div><div className="zone-coordinates">{([['x','X position'],['y','Y position'],['w','Width'],['h','Height']] as const).map(([key,label])=><div key={key}><label htmlFor={`zone-${key}`}>{label}</label><input id={`zone-${key}`} type="number" min="0" max="1" step="0.01" value={config.zone[key]} onChange={event => update('zone', { ...config.zone, [key]: Number(event.target.value) })}/></div>)}</div></div></article>
    <article className="panel settings-card"><div className="settings-section-title"><div className="health-icon purple"><Radio size={17}/></div><div><h2>Alert channels</h2><p>Send a notification when a person is detected in the restricted zone.</p></div></div><label className="toggle-row"><span><strong>Email</strong><small>Send an event notice to your chosen inbox</small></span><input type="checkbox" checked={config.email_enabled} onChange={event => update('email_enabled', event.target.checked)}/></label><label className="toggle-row"><span><strong>Telegram</strong><small>Send the event snapshot to a Telegram chat</small></span><input type="checkbox" checked={config.telegram_enabled} onChange={event => update('telegram_enabled', event.target.checked)}/></label><div className="form-grid"><label className="field"><span>Email recipient</span><input type="email" autoComplete="email" placeholder="you@example.com" value={config.recipient_email ?? ''} onChange={event => update('recipient_email', event.target.value)}/></label><label className="field"><span>Telegram chat ID</span><input inputMode="numeric" placeholder="Your bot chat ID" value={config.telegram_chat_id ?? ''} onChange={event => update('telegram_chat_id', event.target.value)}/></label></div><div className="settings-actions"><button type="button" className="button button-secondary" disabled={saving || isLoading || testingNotification !== null} onClick={() => void testNotification('email')}><Mail size={15}/>{testingNotification === 'email' ? 'Sending…' : 'Test email'}</button><button type="button" className="button button-secondary" disabled={saving || isLoading || testingNotification !== null} onClick={() => void testNotification('telegram')}><Send size={15}/>{testingNotification === 'telegram' ? 'Sending…' : 'Test Telegram'}</button></div><p className="settings-provider-note"><strong>Provider setup:</strong> Save the enabled channel and destination first. Email uses SMTP credentials configured on the local server; Telegram uses its bot token and the chat ID above. Test messages are sent only when you click a test button.</p></article>
    <article className="panel settings-card"><div className="settings-section-title"><div className="health-icon amber"><Wifi size={17}/></div><div><h2>ESP32 hardware</h2><p>Connect your local microcontroller over Wi-Fi.</p></div></div><label className="field"><span>Helper endpoint</span><input readOnly value={HELPER_URL || 'Not configured'} aria-label="Helper endpoint"/></label><div className="settings-actions"><button className="button button-secondary" onClick={() => test('/status')}><Wifi size={15}/> Test connection</button><button className="button button-quiet" onClick={() => test('/test-alarm')}><Siren size={15}/> Test alarm</button><span className="settings-helper">Local hardware status</span></div></article>
    <div className="save-row"><button className="button button-primary" onClick={save} disabled={saving || isLoading}><Save size={15}/> {saving ? 'Saving…' : 'Save settings'}</button><button className="button button-quiet" onClick={signOut}><LogOut size={15}/> Sign out</button></div></section></main>
}
