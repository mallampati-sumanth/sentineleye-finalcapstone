'use client'

import { useEffect, useRef } from 'react'
import { DEFAULT_ZONE } from '@/lib/sentinel'
import { useSentinelSettings } from '@/lib/hooks/use-sentinel-settings'
import { toast } from 'sonner'

type Props = { video: HTMLVideoElement | null; onIntrusion: () => void }
type Prediction = { class: string; score: number; bbox: [number, number, number, number] }

const PERSON_MIN_CONFIDENCE = 0.62
const REQUIRED_CONSECUTIVE_FRAMES = 2
const ABSENCE_RESET_MS = 3000

export function DetectionOverlay({ video, onIntrusion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastAttemptRef = useRef(0)
  const consecutiveHitsRef = useRef(0)
  const personPresentRef = useRef(false)
  const lastSeenInZoneRef = useRef(0)
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

    const saveDetection = async (blob: Blob, personCrop: Blob, confidence: number) => {
      const form = new FormData()
      const timestamp = Date.now()
      form.append('file', blob, `sentinel-${timestamp}.jpg`)
      form.append('person', personCrop, `sentinel-person-${timestamp}.jpg`)
      form.append('metadata', JSON.stringify({ confidence, zone }))
      try {
        const response = await fetch('/api/events', { method: 'POST', body: form })
        const result = await response.json()
        if (response.status === 429) {
          return
        }
        if (!response.ok) throw new Error(result.error || 'Could not save the detection.')
        const alertStatuses = Object.entries(result.alerts ?? {})
        const alertSummary = alertStatuses.map(([channel, status]) => `${channel}: ${status}`).join(' · ')
        const undelivered = alertStatuses.some(([, status]) => status === 'failed' || status === 'not_configured')
        if (undelivered) toast.warning('Person event saved, but an alert channel needs setup.', { description: alertSummary })
        else if (alertStatuses.some(([, status]) => status === 'sent')) toast.success('Person event saved and alert delivered.', { description: alertSummary })
        else toast.info('Person event saved; notifications are disabled.', { description: alertSummary })
        callbackRef.current()
      } catch (error) {
        personPresentRef.current = false
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
        let target: Prediction | null = null
        for (const prediction of predictions) {
          if (prediction.class !== 'person' || prediction.score < PERSON_MIN_CONFIDENCE) continue
          const [x, y, boxWidth, boxHeight] = prediction.bbox
          const centerX = (x + boxWidth / 2) / width
          const centerY = (y + boxHeight / 2) / height
          const inZone = centerX >= zone.x && centerX <= zone.x + zone.w && centerY >= zone.y && centerY <= zone.y + zone.h
          if (inZone && (!target || prediction.score > target.score)) target = prediction
          const confirmed = inZone && consecutiveHitsRef.current + 1 >= REQUIRED_CONSECUTIVE_FRAMES
          ctx.strokeStyle = confirmed ? '#ff3b5c' : '#ffb300'
          ctx.lineWidth = 3
          ctx.strokeRect(x * scale + offsetX, y * scale + offsetY, boxWidth * scale, boxHeight * scale)
          ctx.fillStyle = confirmed ? '#ff3b5c' : '#ffb300'
          ctx.font = '600 12px sans-serif'
          ctx.fillText(
            `${confirmed ? 'PERSON' : 'VERIFYING'} ${Math.round(prediction.score * 100)}%`,
            x * scale + offsetX,
            Math.max(16, y * scale + offsetY - 5),
          )
        }
        const now = Date.now()
        if (target) {
          lastSeenInZoneRef.current = now
          consecutiveHitsRef.current += 1
          if (
            consecutiveHitsRef.current >= REQUIRED_CONSECUTIVE_FRAMES &&
            !personPresentRef.current &&
            now - lastAttemptRef.current > 2000
          ) {
            lastAttemptRef.current = now
            personPresentRef.current = true
            const [x, y, boxWidth, boxHeight] = target.bbox
            const padX = boxWidth * 0.14
            const padY = boxHeight * 0.14
            const cropX = Math.max(0, x - padX)
            const cropY = Math.max(0, y - padY)
            const cropWidth = Math.min(width - cropX, boxWidth + padX * 2)
            const cropHeight = Math.min(height - cropY, boxHeight + padY * 2)
            const capture = document.createElement('canvas')
            capture.width = width
            capture.height = height
            capture.getContext('2d')?.drawImage(video, 0, 0, width, height)
            const personCapture = document.createElement('canvas')
            personCapture.width = Math.max(1, Math.round(cropWidth))
            personCapture.height = Math.max(1, Math.round(cropHeight))
            personCapture.getContext('2d')?.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, personCapture.width, personCapture.height)
            const toJpeg = (canvas: HTMLCanvasElement) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86))
            void Promise.all([toJpeg(capture), toJpeg(personCapture)]).then(([frameBlob, personBlob]) => {
              if (frameBlob && personBlob && alive) void saveDetection(frameBlob, personBlob, target!.score)
            })
          }
        } else {
          consecutiveHitsRef.current = 0
          if (personPresentRef.current && now - lastSeenInZoneRef.current >= ABSENCE_RESET_MS) {
            personPresentRef.current = false
          }
        }
      } catch (error) {
        console.warn('SentinelEye inference frame failed', error)
      }
    }

    load()
    return () => { alive = false; cancelAnimationFrame(frame) }
  }, [video, zone])

  return <canvas ref={canvasRef} className="detection-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} aria-hidden="true" />
}
