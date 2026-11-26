"use client"

import { useEffect, useRef } from "react"
import { DEFAULT_ZONE, HELPER_URL, helperRequest } from "@/lib/sentinel"

type Props = { video: HTMLVideoElement | null; onIntrusion: () => void }
type Prediction = { class: string; score: number; bbox: [number, number, number, number] }

export function DetectionOverlay({ video, onIntrusion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastSentRef = useRef(0)
  const callbackRef = useRef(onIntrusion)
  callbackRef.current = onIntrusion

  useEffect(() => {
    if (!video || !HELPER_URL) return
    let alive = true
    let frame = 0
    let model: any = null
    let lastInference = 0
    let sharedZone = DEFAULT_ZONE
    try {
      const localZone = JSON.parse(localStorage.getItem("sentinel-zone") || "null")
      if (localZone && Number.isFinite(localZone.x) && Number.isFinite(localZone.y)) sharedZone = localZone
    } catch { /* Keep the default zone when local settings are unavailable. */ }
    const syncZone = async () => {
      try {
        const result = await helperRequest("/config")
        const zone = result.config?.zone
        if (zone && Number.isFinite(zone.x) && Number.isFinite(zone.y)) sharedZone = zone
      } catch { /* Continue with the last known zone while the helper is offline. */ }
    }
    const zoneTimer = setInterval(syncZone, 5000)

    const load = async () => {
      try {
        const coco = await import("@tensorflow-models/coco-ssd")
        await import("@tensorflow/tfjs")
        model = await coco.load({ base: "lite_mobilenet_v2" })
        if (alive) frame = requestAnimationFrame(detectFrame)
      } catch (error) {
        console.warn("SentinelEye person detection could not initialize", error)
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
      const ctx = canvas.getContext("2d")
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
        const zone = sharedZone
        let found = false
        for (const prediction of predictions) {
          if (prediction.class !== "person" || prediction.score < 0.5) continue
          const [x, y, boxWidth, boxHeight] = prediction.bbox
          ctx.strokeStyle = "#ff3b5c"
          ctx.lineWidth = 3
          ctx.strokeRect(x * scale + offsetX, y * scale + offsetY, boxWidth * scale, boxHeight * scale)
          ctx.fillStyle = "#ff3b5c"
          ctx.font = "600 12px sans-serif"
          ctx.fillText(`PERSON ${Math.round(prediction.score * 100)}%`, x * scale + offsetX, Math.max(16, y * scale + offsetY - 5))
          const centerX = (x + boxWidth / 2) / width
          const centerY = (y + boxHeight / 2) / height
          if (centerX >= zone.x && centerX <= zone.x + zone.w && centerY >= zone.y && centerY <= zone.y + zone.h) found = true
        }
        if (found && Date.now() - lastSentRef.current > 30000) {
          lastSentRef.current = Date.now()
          const config = JSON.parse(localStorage.getItem("sentinel-config") || "{}")
          const cooldown = Math.max(30, Number(config.cooldown) || 300) * 1000
          const next = Number(localStorage.getItem("sentinel-next-alert") || 0)
          if (Date.now() >= next) {
            const capture = document.createElement("canvas")
            capture.width = width
            capture.height = height
            capture.getContext("2d")?.drawImage(video, 0, 0, width, height)
            capture.toBlob(async (blob) => {
              if (!blob || !alive) return
              const form = new FormData()
              form.append("file", blob, `sentinel-${Date.now()}.jpg`)
              form.append("metadata", JSON.stringify({ type: "ai", source: "phone-camera", person_detected: true, confidence: Math.max(...predictions.filter((item) => item.class === "person").map((item) => item.score)), zone }))
              try {
                const result = await helperRequest("/alert", { method: "POST", body: form })
                if (result.status === "ok") {
                  localStorage.setItem("sentinel-next-alert", String(Date.now() + cooldown))
                  callbackRef.current()
                } else if (result.status === "cooldown" && result.remaining) {
                  localStorage.setItem("sentinel-next-alert", String(Date.now() + result.remaining * 1000))
                }
              } catch (error) {
                console.warn("Could not submit SentinelEye snapshot", error)
              }
            }, "image/jpeg", 0.82)
          }
        }
      } catch (error) {
        console.warn("SentinelEye inference frame failed", error)
      }
    }
    syncZone()
    load()
    return () => { alive = false; clearInterval(zoneTimer); cancelAnimationFrame(frame) }
  }, [video])

  return <canvas ref={canvasRef} className="detection-overlay" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }} aria-hidden="true" />
}
