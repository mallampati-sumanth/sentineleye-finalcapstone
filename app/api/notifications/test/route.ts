import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type NotificationChannel = 'email' | 'telegram'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 })
  }

  let channel: NotificationChannel
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || !('channel' in body) || !['email', 'telegram'].includes(String(body.channel))) {
      return NextResponse.json({ error: 'Choose email or Telegram to test.' }, { status: 400 })
    }
    channel = body.channel as NotificationChannel
  } catch {
    return NextResponse.json({ error: 'The test request must contain valid JSON.' }, { status: 400 })
  }

  const { data: settings, error: settingsError } = await supabase
    .from('sentinel_settings')
    .select('recipient_email, telegram_chat_id, email_enabled, telegram_enabled')
    .eq('user_id', user.id)
    .maybeSingle()

  if (settingsError) {
    console.error('Could not load notification test settings')
    return NextResponse.json({ error: 'Could not load your saved notification settings.' }, { status: 500 })
  }

  if (channel === 'email') {
    if (!settings?.email_enabled || !settings.recipient_email) {
      return NextResponse.json({ error: 'Enable email alerts and save a recipient address first.' }, { status: 400 })
    }

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
      return NextResponse.json({ error: 'SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in the local server environment.' }, { status: 503 })
    }

    const port = Number(SMTP_PORT || 587)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: 'SMTP_PORT must be a valid port number.' }, { status: 500 })
    }

    try {
      const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
      })
      await transport.sendMail({
        from: SMTP_FROM,
        to: settings.recipient_email,
        subject: 'SentinelEye email notification test',
        text: 'Your SentinelEye SMTP notification setup is working.',
      })
      return NextResponse.json({ status: 'sent', channel })
    } catch {
      return NextResponse.json({ error: 'SMTP could not deliver the test email. Check the host, port, credentials, sender address, and server logs.' }, { status: 502 })
    }
  }

  if (!settings?.telegram_enabled || !settings.telegram_chat_id) {
    return NextResponse.json({ error: 'Enable Telegram alerts and save a chat ID first.' }, { status: 400 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'Telegram is not configured. Set TELEGRAM_BOT_TOKEN in the local server environment.' }, { status: 503 })
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.telegram_chat_id,
        text: [
          '🔐 <b>SENTINELEYE</b>',
          '',
          '✅ <b>Telegram connection test</b>',
          'Your SentinelEye account can send alerts to this chat.',
          '',
          '<i>Test only · no intrusion detected</i>',
        ].join('\n'),
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      return NextResponse.json({ error: `Telegram rejected the test message (HTTP ${response.status}). Check the bot token, chat ID, and that the bot has been started.` }, { status: 502 })
    }
    return NextResponse.json({ status: 'sent', channel })
  } catch {
    return NextResponse.json({ error: 'Could not reach the Telegram API. Check the server internet connection and try again.' }, { status: 502 })
  }
}
