"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Activity, Camera, CameraOff, Circle, ExternalLink, Radio, Wifi } from "lucide-react"
import { Toaster, toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { DetectionOverlay } from "@/components/detection-overlay"
import { BrandLogo } from "@/components/brand-logo"
import type { Peer, PeerError, MediaConnection } from "peerjs"

function cameraErrorMessage(error: { name?: string; type?: string }) {
  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    return "Allow camera access in your browser settings, then retry."
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "No camera was found on this device."
  }
  switch (error.type) {
    case "network":
    case "server-error":
    case "socket-error":
    case "socket-closed":
      return "Could not reach PeerJS signaling. Check your internet connection and allow WebSocket connections."
    case "unavailable-id":
      return "This camera ID is already in use. Close the other camera tab and retry."
    case "browser-incompatible":
      return "This browser does not support WebRTC video calling."
    default:
      return "Camera pairing failed. Check your sign-in and network connection, then retry."
  }
}

export default function CameraNode() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const peerRef = useRef<Peer | null>(null)
  const callsRef = useRef(new Set<MediaConnection>())
  const [state, setState] = useState("CONNECTING")
  const [statusMessage, setStatusMessage] = useState("Starting camera…")
  const [viewers, setViewers] = useState(0)
  const [started, setStarted] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [cameraClock, setCameraClock] = useState("")
  const [cameraPeerId, setCameraPeerId] = useState("")
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [intrusion, setIntrusion] = useState(false)

  useEffect(() => {
    let active = true
    let peer: Peer | null = null
    let stream: MediaStream | null = null
    let pairingTimeout: ReturnType<typeof setTimeout> | null = null

    const fail = (message: string) => {
      if (!active) return
      if (pairingTimeout) clearTimeout(pairingTimeout)
      peer?.destroy()
      peer = null
      peerRef.current = null
      setState("ERROR")
      setStatusMessage(message)
    }

    const connect = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Open this page on localhost or HTTPS to use the camera.")
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        })
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; setVideoElement(videoRef.current) }
        setStarted(Date.now())
        if ("wakeLock" in navigator) (navigator as any).wakeLock.request("screen").catch(() => undefined)

        setState("PAIRING")
        setStatusMessage("Connecting to the camera signaling service…")
        const supabase = createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) throw new Error("Sign in on this device before pairing the camera.")

        const assignedPeerId = `sentinel-${crypto.randomUUID()}`
        const { default: Peer } = await import("peerjs")
        peer = new Peer(assignedPeerId)
        peerRef.current = peer
        pairingTimeout = setTimeout(() => fail("Could not reach PeerJS signaling. Check your internet connection and retry."), 15000)

        peer.on("open", async () => {
          if (!active || peerRef.current !== peer) return
          if (pairingTimeout) clearTimeout(pairingTimeout)
          setStatusMessage("Saving camera pairing…")
          try {
            const { error: saveError } = await supabase.from("sentinel_settings").upsert({ user_id: user.id, camera_peer_id: assignedPeerId })
            if (saveError) {
              fail("Could not save this camera pairing. Check your account settings and retry.")
              return
            }
          } catch {
            fail("Could not save this camera pairing. Check your internet connection and account settings.")
            return
          }
          if (!active || peerRef.current !== peer) return
          setCameraPeerId(assignedPeerId)
          setState("LIVE")
          setStatusMessage("Camera is ready for the monitor.")
        })

        peer.on("call", (call: MediaConnection) => {
          if (!active || !stream) {
            call.close()
            return
          }
          call.answer(stream)
          callsRef.current.add(call)
          setViewers((count) => count + 1)
          call.on("close", () => {
            if (callsRef.current.delete(call)) setViewers((count) => Math.max(0, count - 1))
          })
          call.on("error", (error: PeerError<string>) => {
            toast.error(cameraErrorMessage(error))
          })
        })
        peer.on("error", (error: PeerError<string>) => fail(cameraErrorMessage(error)))
      } catch (error) {
        fail(error instanceof Error ? error.message : "Could not start the camera. Retry and check browser permissions.")
      }
    }

    connect()
    return () => {
      active = false
      if (pairingTimeout) clearTimeout(pairingTimeout)
      callsRef.current.forEach((call) => call.close())
      callsRef.current.clear()
      peer?.destroy()
      peerRef.current = null
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    setCameraClock(new Date().toLocaleTimeString())
    const ticker = setInterval(() => setCameraClock(new Date().toLocaleTimeString()), 1000)
    return () => clearInterval(ticker)
  }, [])

  useEffect(() => {
    if (!started) return
    const ticker = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(ticker)
  }, [started])

  const time = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
  return <main className="camera-page">
    <video ref={videoRef} autoPlay muted playsInline className="camera-feed" aria-label="Live phone camera preview" />
    <DetectionOverlay video={videoElement} onIntrusion={() => setIntrusion(true)} />
    <div className="camera-shade" />
    <Toaster theme="light" position="top-center" />
    <header className="camera-top"><Link href="/viewer" className="brand"><BrandLogo inverse /></Link><span className={`live-pill ${state.toLowerCase()}`}><i />{state}</span></header>
    <div className="camera-center">{state !== "LIVE" && <div className="camera-wait"><Camera size={30} /><h1>{state === "ERROR" ? "Camera setup failed" : state === "PAIRING" ? "Pairing camera" : "Starting camera node"}</h1><p role="status">{statusMessage}</p>{state === "ERROR" && <button onClick={() => window.location.reload()} className="outline-button"><CameraOff size={16} /> Retry camera</button>}</div>}</div>
    <div className="rec-label"><span className="rec-dot" /> REC <time>{cameraClock || "--:--:--"}</time></div>
    <footer className="camera-footer"><div><span className="meta-label">CAMERA NODE</span><strong>{cameraPeerId ? `${cameraPeerId.slice(0, 16)}…` : "PAIRING…"}</strong></div><div><span className="meta-label">VIEWERS</span><strong><Wifi size={15} /> {viewers}</strong></div><div><span className="meta-label">UPTIME</span><strong>{time}</strong></div><Link href="/viewer" className="monitor-link">Open monitor <ExternalLink size={14} /></Link></footer>
    <div className="camera-corner"><Radio size={15} /> {intrusion ? "PERSON IN RESTRICTED ZONE" : "Local camera stream"} · AI detection runs on this device</div>
  </main>
}
