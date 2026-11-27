import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import './theme.css'
import { AuthGate } from '@/components/auth-gate'

export const metadata: Metadata = {
  title: 'SentinelEye — AI Smart Surveillance',
  description: 'Private, remote camera monitoring with person detection, event snapshots, and configurable alerts.',
  generator: 'v0.app',
  applicationName: 'SentinelEye',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: 'white',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthGate>{children}</AuthGate>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
