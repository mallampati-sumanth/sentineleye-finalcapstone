import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

type AlertResult = { email: 'sent' | 'disabled' | 'not_configured' | 'failed'; telegram: 'sent' | 'disabled' | 'not_configured' | 'failed' }

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File) || !['image/jpeg', 'image/png'].includes(file.type) || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Choose a JPEG or PNG snapshot smaller than 8 MB.' }, { status: 400 })
  }

  const metadataValue = String(form.get('metadata') ?? '{}')
  if (metadataValue.length > 4096) return NextResponse.json({ error: 'Snapshot details are too large.' }, { status: 400 })
  let metadata: { confidence?: number; zone?: { x: number; y: number; w: number; h: number } }
  try {
    const parsed: unknown = JSON.parse(metadataValue)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid details')
    metadata = parsed as { confidence?: number; zone?: { x: number; y: number; w: number; h: number } }
  } catch {
    return NextResponse.json({ error: 'Snapshot details are invalid.' }, { status: 400 })
  }
  const confidence = Number(metadata.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return NextResponse.json({ error: 'Detection confidence is invalid.' }, { status: 400 })
  }

  const { data: settings } = await supabase
    .from('sentinel_settings')
    .select('zone, alert_cooldown_seconds, recipient_email, telegram_chat_id, email_enabled, telegram_enabled')
    .eq('user_id', user.id)
    .maybeSingle()
  const id = crypto.randomUUID()
  const storagePath = `${user.id}/${id}.${file.type === 'image/png' ? 'png' : 'jpg'}`
  const image = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage.from('sentinel-snapshots').upload(storagePath, image, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  })
  if (uploadError) return NextResponse.json({ error: 'Could not save the private snapshot.' }, { status: 500 })

  const candidateZone = metadata.zone
  const zoneIsValid = candidateZone && [candidateZone.x, candidateZone.y, candidateZone.w, candidateZone.h].every(value => Number.isFinite(value) && value >= 0 && value <= 1) && candidateZone.x + candidateZone.w <= 1 && candidateZone.y + candidateZone.h <= 1
  const zone = zoneIsValid ? candidateZone : settings?.zone ?? {}
  const { data: recordingData, error: insertError } = await supabase.rpc('record_sentinel_detection', {
    p_id: id,
    p_confidence: confidence,
    p_storage_path: storagePath,
    p_zone: zone,
  }).maybeSingle()
  const recording = recordingData as { allowed: boolean; remaining_seconds: number; event_id: string; created_at: string } | null
  if (insertError) {
    await supabase.storage.from('sentinel-snapshots').remove([storagePath])
    return NextResponse.json({ error: 'Could not save the event.' }, { status: 500 })
  }
  if (!recording?.allowed) {
    await supabase.storage.from('sentinel-snapshots').remove([storagePath])
    return NextResponse.json({ status: 'cooldown', remainingSeconds: recording?.remaining_seconds ?? 1 }, { status: 429 })
  }
  const event = {
    id: recording.event_id,
    event_type: 'person_detected',
    created_at: recording.created_at,
    confidence,
    source: 'phone-camera',
    storage_path: storagePath,
  }

  const alerts: AlertResult = { email: 'disabled', telegram: 'disabled' }
  const eventTime = new Date(event.created_at).toLocaleString()
  if (settings?.email_enabled && settings.recipient_email) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
      alerts.email = 'not_configured'
    } else {
      try {
        const transport = nodemailer.createTransport({
          host: SMTP_HOST,
          port: Number(SMTP_PORT || 587),
          secure: Number(SMTP_PORT || 587) === 465,
          auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
        })
        await transport.sendMail({
          from: SMTP_FROM,
          to: settings.recipient_email,
          subject: 'SentinelEye: person detected in your restricted zone',
          text: `A person was detected at ${eventTime} (${Math.round(confidence * 100)}% confidence). Open your signed-in SentinelEye monitor to review the private snapshot.`,
        })
        alerts.email = 'sent'
      } catch {
        alerts.email = 'failed'
      }
    }
  }

  if (settings?.telegram_enabled && settings.telegram_chat_id) {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      alerts.telegram = 'not_configured'
    } else {
      try {
        const telegramForm = new FormData()
        telegramForm.set('chat_id', settings.telegram_chat_id)
        telegramForm.set('caption', `SentinelEye detected a person at ${eventTime} (${Math.round(confidence * 100)}% confidence).`)
        telegramForm.set('photo', new Blob([image], { type: file.type }), file.name || 'sentinel-snapshot.jpg')
        const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: telegramForm, signal: AbortSignal.timeout(8000) })
        alerts.telegram = response.ok ? 'sent' : 'failed'
      } catch {
        alerts.telegram = 'failed'
      }
    }
  }

  return NextResponse.json({ status: 'saved', id: event.id, createdAt: event.created_at, alerts })
}
