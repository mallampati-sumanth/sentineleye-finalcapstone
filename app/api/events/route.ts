import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

type AlertResult = { email: 'sent' | 'disabled' | 'not_configured' | 'failed'; telegram: 'sent' | 'disabled' | 'not_configured' | 'failed' }

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  const personFile = form.get('person')
  if (!(file instanceof File) || !['image/jpeg', 'image/png'].includes(file.type) || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Choose a JPEG or PNG snapshot smaller than 8 MB.' }, { status: 400 })
  }
  if (personFile != null && (!(personFile instanceof File) || !['image/jpeg', 'image/png'].includes(personFile.type) || personFile.size === 0 || personFile.size > MAX_IMAGE_BYTES)) {
    return NextResponse.json({ error: 'The person crop must be a JPEG or PNG image smaller than 8 MB.' }, { status: 400 })
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
  const personImage = personFile instanceof File ? Buffer.from(await personFile.arrayBuffer()) : null
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
        const confidenceText = `${Math.round(confidence * 100)}%`
        const detailAttachment = personImage && personFile instanceof File
          ? { filename: 'sentinel-person-detail.jpg', content: personImage, contentType: personFile.type, cid: 'sentinel-person-detail' }
          : null
        await transport.sendMail({
          from: SMTP_FROM,
          to: settings.recipient_email,
          subject: 'SentinelEye security alert: person detected',
          text: [
            'SENTINELEYE SECURITY ALERT',
            '',
            'A person was detected inside your restricted monitoring zone.',
            `Detected: ${eventTime}`,
            `Model confidence: ${confidenceText}`,
            `Event reference: ${event.id}`,
            '',
            'The full-frame snapshot is attached. A person-detail crop is also attached when available.',
            'Sign in to SentinelEye to review your private event history.',
          ].join('\n'),
          html: `<div style="margin:0;padding:32px 16px;background:#f3f5f8;font-family:Arial,sans-serif;color:#202633"><div style="max-width:600px;margin:0 auto;padding:28px;background:#fff;border:1px solid #e1e5ec;border-radius:12px"><p style="margin:0 0 8px;color:#687386;font-size:12px;font-weight:700;letter-spacing:1px">SENTINELEYE SECURITY ALERT</p><h1 style="margin:0 0 14px;font-size:24px">Person detected</h1><p style="margin:0 0 22px;line-height:1.6">A person was detected inside your restricted monitoring zone.</p><table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:22px"><tr><td style="padding:9px 0;color:#687386">Detected</td><td style="padding:9px 0;text-align:right;font-weight:700">${eventTime}</td></tr><tr><td style="padding:9px 0;color:#687386;border-top:1px solid #edf0f4">Model confidence</td><td style="padding:9px 0;text-align:right;font-weight:700;border-top:1px solid #edf0f4">${confidenceText}</td></tr><tr><td style="padding:9px 0;color:#687386;border-top:1px solid #edf0f4">Event reference</td><td style="padding:9px 0;text-align:right;font-family:monospace;border-top:1px solid #edf0f4">${event.id}</td></tr></table><h2 style="margin:0 0 10px;font-size:16px">Captured images</h2><p style="margin:0 0 10px;color:#687386;font-size:13px">The full frame${detailAttachment ? ' and person-detail crop' : ''} are attached to this email.</p><img src="cid:sentinel-overview" alt="Full-frame detection snapshot" style="display:block;width:100%;max-width:520px;height:auto;margin:12px 0;border-radius:8px">${detailAttachment ? '<img src="cid:sentinel-person-detail" alt="Person detail crop" style="display:block;width:100%;max-width:520px;height:auto;margin:12px 0;border-radius:8px">' : ''}<p style="margin:22px 0 0;color:#687386;font-size:12px;line-height:1.5">Review this private event by signing in to SentinelEye. This automated message was sent because email alerts are enabled for your account.</p></div></div>`,
          attachments: [
            { filename: 'sentinel-overview.jpg', content: image, contentType: file.type, cid: 'sentinel-overview' },
            ...(detailAttachment ? [detailAttachment] : []),
          ],
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
        const caption = [
          '🚨 <b>SENTINELEYE · SECURITY ALERT</b>',
          '',
          '<b>Person detected</b> in the restricted monitoring zone.',
          '',
          `🕒 <b>Detected:</b> ${escapeTelegramHtml(eventTime)}`,
          `🎯 <b>Confidence:</b> ${Math.round(confidence * 100)}%`,
          `🆔 <b>Event:</b> <code>${escapeTelegramHtml(event.id)}</code>`,
          '',
          '<i>Review the captured snapshot in SentinelEye.</i>',
        ].join('\n')
        let endpoint = 'sendPhoto'
        if (personImage && personFile instanceof File) {
          endpoint = 'sendMediaGroup'
          telegramForm.set('media', JSON.stringify([
            { type: 'photo', media: 'attach://overview', caption, parse_mode: 'HTML' },
            { type: 'photo', media: 'attach://person' },
          ]))
          telegramForm.set('overview', new Blob([image], { type: file.type }), 'sentinel-overview.jpg')
          telegramForm.set('person', new Blob([personImage], { type: personFile.type }), 'sentinel-person-detail.jpg')
        } else {
          telegramForm.set('caption', caption)
          telegramForm.set('parse_mode', 'HTML')
          telegramForm.set('photo', new Blob([image], { type: file.type }), 'sentinel-overview.jpg')
        }
        const response = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, { method: 'POST', body: telegramForm, signal: AbortSignal.timeout(8000) })
        const result = await response.json().catch(() => null)
        alerts.telegram = response.ok && result?.ok === true ? 'sent' : 'failed'
      } catch {
        alerts.telegram = 'failed'
      }
    }
  }

  return NextResponse.json({ status: 'saved', id: event.id, createdAt: event.created_at, alerts })
}
