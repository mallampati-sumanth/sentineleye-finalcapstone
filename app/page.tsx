"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Activity, Camera, CameraOff, Circle, ExternalLink, Radio, Shield, Wifi } from "lucide-react"
import { Toaster, toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { DetectionOverlay } from "@/components/detection-overlay"

export default function CameraNode() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const peerRef = useRef<any>(null)
  const [state, setState] = useState("CONNECTING")
  const [viewers, setViewers] = useState(0)
  const [started, setStarted] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [cameraClock, setCameraClock] = useState("")
  const [cameraPeerId, setCameraPeerId] = useState("")
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [intrusion, setIntrusion] = useState(false)

  useEffect(() => {
    let active = true
    let retry: ReturnType<typeof setTimeout>
    let peerModule: any
    const connect = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; setVideoElement(videoRef.current) }
        setState("LIVE")
        setStarted(Date.now())
        if ("wakeLock" in navigator) (navigator as any).wakeLock.request("screen").catch(() => undefined)
        const supabase = createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) throw new Error("Sign in to pair this camera.")
        const assignedPeerId = `sentinel-${crypto.randomUUID()}`
        const { error: saveError } = await supabase.from("sentinel_settings").upsert({ user_id: user.id, camera_peer_id: assignedPeerId })
        if (saveError) throw new Error("Could not securely pair this camera.")
        setCameraPeerId(assignedPeerId)
        const { default: Peer } = await import("peerjs")
        peerModule = Peer
        const peer = new Peer(assignedPeerId)
        peerRef.current = peer
        peer.on("open", () => setState("LIVE"))
        peer.on("call", (call: any) => { call.answer(stream); setViewers((n) => n + 1); call.on("close", () => setViewers((n) => Math.max(0, n - 1))) })
        peer.on("error", (error: any) => { setState("ERROR"); if (error.type === "unavailable-id") toast.error("A camera node is already using this ID. Close the other sender tab.") })
      } catch {
        if (!active) return
        setState("ERROR")
        retry = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => { active = false; clearTimeout(retry); peerRef.current?.destroy(); streamRef.current?.getTracks().forEach((track) => track.stop()) }
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
    <Toaster theme="dark" position="top-center" />
    <header className="camera-top"><Link href="/viewer" className="brand"><span className="brand-mark"><Shield size={19} /></span> Sentinel<span>Eye</span></Link><span className={`live-pill ${state.toLowerCase()}`}><i />{state}</span></header>
    <div className="camera-center">{state !== "LIVE" && <div className="camera-wait"><Camera size={30} /><h1>{state === "ERROR" ? "Camera access needed" : "Starting camera node"}</h1><p>Allow camera access and keep this tab open to stream to the monitor.</p><button onClick={() => window.location.reload()} className="outline-button"><CameraOff size={16} /> Retry camera</button></div>}</div>
    <div className="rec-label"><span className="rec-dot" /> REC <time>{cameraClock || "--:--:--"}</time></div>
    <footer className="camera-footer"><div><span className="meta-label">CAMERA NODE</span><strong>{cameraPeerId ? `${cameraPeerId.slice(0, 16)}…` : "PAIRING…"}</strong></div><div><span className="meta-label">VIEWERS</span><strong><Wifi size={15} /> {viewers}</strong></div><div><span className="meta-label">UPTIME</span><strong>{time}</strong></div><Link href="/viewer" className="monitor-link">Open monitor <ExternalLink size={14} /></Link></footer>
    <div className="camera-corner"><Radio size={15} /> {intrusion ? "PERSON IN RESTRICTED ZONE" : "Local camera stream"} · AI detection runs on this device</div>
  </main>
}
