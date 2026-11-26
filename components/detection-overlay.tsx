'use client'

import { useEffect, useRef } from 'react'
import { DEFAULT_ZONE } from '@/lib/sentinel'
import { useSentinelSettings } from '@/lib/hooks/use-sentinel-settings'
import { toast } from 'sonner'

type Props = { video: HTMLVideoElement | null; onIntrusion: () => void }
type Prediction = { class: string; score: number; bbox: [number, number, number, number] }

export function DetectionOverlay({ video, onIntrusion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastAttemptRef = useRef(0)
  const blockedUntilRef = useRef(0)
  const callbackRef = useRef(onIntrusion)
  const { data: settings } = useSentinelSettings()
  callbackRef.current = onIntrusion
  const zone = settings?.zone ?? DEFAULT_ZONE

  useEffect(() => {
    if (!video) return
    let alive = true
    let frame = 0
    let model: any = null
    let lastInference = 0

    const load = async () => {
      try {
        const coco = await import('@tensorflow-models/coco-ssd')
        await import('@tensorflow/tfjs')
        model = await coco.load({ base: 'lite_mobilenet_v2' })
        if (alive) frame = requestAnimationFrame(detectFrame)
      } catch (error) {
        console.warn('SentinelEye person detection could not initialize', error)
      }
    }

    const saveDetection = async (blob: Blob, confidence: number) => {
      const form = new FormData()
      form.append('file', blob, `sentinel-${Date.now()}.jpg`)
      form.append('metadata', JSON.stringify({ confidence, zone }))
      try {
        const response = await fetch('/api/events', { method: 'POST', body: form })
        const result = await response.json()
        if (response.status === 429 && result.remainingSeconds) {
          blockedUntilRef.current = Date.now() + result.remainingSeconds * 1000
          return
        }
        if (!response.ok) throw new Error(result.error || 'Could not save the detection.')
        blockedUntilRef.current = Date.now() + (settings?.alert_cooldown_seconds ?? 300) * 1000
        const undelivered = Object.entries(result.alerts ?? {}).filter(([, status]) => status === 'failed' || status === 'not_configured')
        if (undelivered.length) toast.warning('Event saved, but an alert channel is not ready. Check your provider setup.')
        callbackRef.current()
      } catch (error) {
        blockedUntilRef.current = Date.now() + 5000
        console.warn('Could not save SentinelEye detection', error)
      }
    }

    const detectFrame = async (time: number) => {
      if (!alive) return
      frame = requestAnimationFrame(detectFrame)
      if (!model || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || time - lastInference < 250) return
      lastInference = time
      const canvas = canvasRef.current
      if (!canvas) return
      const width = video.videoWidth
      const height = video.videoHeight
      if (!width || !height) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const scale = Math.max(canvas.clientWidth / width, canvas.clientHeight / height)
      const offsetX = (canvas.clientWidth - width * scale) / 2
      const offsetY = (canvas.clientHeight - height * scale) / 2
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(canvas.clientWidth * dpr) || canvas.height !== Math.round(canvas.clientHeight * dpr)) {
        canvas.width = Math.round(canvas.clientWidth * dpr)
        canvas.height = Math.round(canvas.clientHeight * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
      try {
        const predictions: Prediction[] = await model.detect(video)
        if (!alive) return
        let found = false
        const personScores: number[] = []
        for (const prediction of predictions) {
          if (prediction.class !== 'person' || prediction.score < 0.5) continue
          personScores.push(prediction.score)
          const [x, y, boxWidth, boxHeight] = prediction.bbox
          ctx.strokeStyle = '#ff3b5c'
          ctx.lineWidth = 3
          ctx.strokeRect(x * scale + offsetX, y * scale + offsetY, boxWidth * scale, boxHeight * scale)
          ctx.fillStyle = '#ff3b5c'
          ctx.font = '600 12px sans-serif'
          ctx.fillText(`PERSON ${Math.round(prediction.score * 100)}%`, x * scale + offsetX, Math.max(16, y * scale + offsetY - 5))
          const centerX = (x + boxWidth / 2) / width
          const centerY = (y + boxHeight / 2) / height
          if (centerX >= zone.x && centerX <= zone.x + zone.w && centerY >= zone.y && centerY <= zone.y + zone.h) found = true
        }
        if (found && Date.now() >= blockedUntilRef.current && Date.now() - lastAttemptRef.current > 5000) {
          lastAttemptRef.current = Date.now()
          const capture = document.createElement('canvas')
          capture.width = width
          capture.height = height
          capture.getContext('2d')?.drawImage(video, 0, 0, width, height)
          capture.toBlob(blob => {
            if (blob && alive) void saveDetection(blob, Math.max(...personScores))
          }, 'image/jpeg', 0.82)
        }
      } catch (error) {
        console.warn('SentinelEye inference frame failed', error)
      }
    }

    load()
    return () => { alive = false; cancelAnimationFrame(frame) }
  }, [video, zone, settings?.alert_cooldown_seconds])

  return <canvas ref={canvasRef} className="detection-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} aria-hidden="true" />
}
