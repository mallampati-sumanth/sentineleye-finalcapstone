"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Activity, Bell, Camera, CameraOff, Circle, ChevronDown, CircleHelp, Clock3, Expand, Image, Link2, Radio, Shield, ShieldAlert, Siren, Video, Volume2, VolumeX, Wifi, Zap } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts"
import { toast, Toaster } from "sonner"
import { BrandLogo } from "@/components/brand-logo"
import { DEFAULT_ZONE, fmtTime, HELPER_URL, helperRequest } from "@/lib/sentinel"
import { useSentinelEvents, type SentinelEvent } from "@/lib/hooks/use-sentinel-events"
import { DEFAULT_SETTINGS, saveSentinelSettings, useSentinelSettings } from "@/lib/hooks/use-sentinel-settings"
import { mutate } from "swr"
import type { MediaConnection, Peer as PeerJS, PeerError } from "peerjs"

type HelperStatus = {
  online: boolean
  alarm: boolean
  uptime: number
  last_pir?: number | null
  last_ai?: number | null
}

function cameraConnectionError(error: PeerError<string>) {
  switch (error.type) {
    case "peer-unavailable":
      return "Camera is not connected to PeerJS. Keep the camera node open and wait for it to show LIVE."
    case "network":
    case "server-error":
    case "socket-error":
    case "socket-closed":
      return "Could not reach PeerJS signaling. Check your internet connection and allow WebSocket connections."
    case "webrtc":
      return "The camera was found, but WebRTC could not connect across this network. Try both devices on the same Wi-Fi."
    case "browser-incompatible":
      return "This browser does not support WebRTC video calling."
    default:
      return `Could not connect to camera${error.type ? ` (${error.type})` : ""}. Keep the camera node open and try again.`
  }
}

export default function Viewer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const peerRef = useRef<PeerJS | null>(null)
  const cameraCallRef = useRef<MediaConnection | null>(null)
  const [status, setStatus] = useState<HelperStatus | null>(null)
  const [helperReachable, setHelperReachable] = useState(false)
  const { data: eventData = [], error: eventError } = useSentinelEvents()
  const { data: accountSettings } = useSentinelSettings()
  const events = eventData
  const [zone, setZone] = useState(DEFAULT_ZONE)
  const seenEventsRef = useRef(new Set<string>())
  const [drawing, setDrawing] = useState(false)
  const [start, setStart] = useState<{x:number;y:number}|null>(null)
  const [sound, setSound] = useState(true)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [clock, setClock] = useState<Date | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [snapshotOpen, setSnapshotOpen] = useState<SentinelEvent | null>(null)
  const soundRef = useRef(sound)
  soundRef.current = sound

  useEffect(() => {
    setClock(new Date())
    const tick = setInterval(() => setClock(new Date()), 1000)
    const refreshStatus = async () => {
      if (!HELPER_URL) {
        setStatus(null)
        setHelperReachable(false)
        return
      }
      try {
        const data = await helperRequest("/status") as HelperStatus
        setStatus(data)
        setHelperReachable(true)
      } catch {
        setStatus(null)
        setHelperReachable(false)
      }
    }
    refreshStatus()
    const a = setInterval(refreshStatus, 3000)
    return () => { clearInterval(tick); clearInterval(a); cameraCallRef.current?.close(); peerRef.current?.destroy(); streamRef.current?.getTracks().forEach((track) => track.stop()) }
  }, [])

  useEffect(() => {
    if (!events.length) return
    if (!seenEventsRef.current.size) {
      events.forEach(event => seenEventsRef.current.add(event.id))
      return
    }
    const fresh = events.filter(event => !seenEventsRef.current.has(event.id))
    fresh.forEach(event => {
      seenEventsRef.current.add(event.id)
      toast.error("Person detected in restricted zone", { description: fmtTime(event.timestamp) })
      if (soundRef.current) playAlarm()
    })
  }, [events])

  useEffect(() => { if (accountSettings?.zone) setZone(accountSettings.zone) }, [accountSettings?.zone])

  useEffect(() => {
    const update = () => {
      const cooldownSeconds = accountSettings?.alert_cooldown_seconds ?? DEFAULT_SETTINGS.alert_cooldown_seconds
      const lastEvent = events[0]?.timestamp ?? 0
      setCooldown(Math.max(0, Math.ceil(cooldownSeconds - (Date.now() / 1000 - lastEvent))))
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [accountSettings?.alert_cooldown_seconds, events])
  const connectPhone = async () => {
    const targetPeerId = accountSettings?.camera_peer_id
    if (connecting) return
    if (!targetPeerId) {
      const message = "No camera is paired. Open the camera node on your signed-in phone first."
      setCameraError(message)
      toast.error(message)
      return
    }
    if (peerRef.current) {
      cameraCallRef.current?.close()
      peerRef.current.destroy()
      peerRef.current = null
      cameraCallRef.current = null
    }
    setConnected(false)
    setConnecting(true)
    setCameraError("")
    try {
      const { default: Peer } = await import("peerjs")
      const peer = new Peer()
      peerRef.current = peer
      let timeout: ReturnType<typeof setTimeout> | null = null
      let placeholder: MediaStream | null = null
      let call: MediaConnection | null = null
      let settled = false
      const clearConnectionTimeout = () => {
        if (timeout) clearTimeout(timeout)
        timeout = null
      }
      const fail = (message: string) => {
        if (settled) return
        settled = true
        clearConnectionTimeout()
        placeholder?.getTracks().forEach((track) => track.stop())
        if (cameraCallRef.current === call) cameraCallRef.current = null
        if (peerRef.current === peer) peerRef.current = null
        call?.close()
        peer.destroy()
        setConnected(false)
        setConnecting(false)
        setCameraError(message)
        toast.error(message)
      }

      timeout = setTimeout(() => fail("Could not reach PeerJS signaling. Check your internet connection and allow WebSocket connections."), 15000)
      peer.on("open", () => {
        if (peerRef.current !== peer || settled) return
        clearConnectionTimeout()
        if (!HTMLCanvasElement.prototype.captureStream) {
          fail("This browser cannot start a WebRTC video call. Try an up-to-date Chrome, Edge, or Firefox.")
          return
        }
        const canvas = document.createElement("canvas")
        canvas.width = 1
        canvas.height = 1
        placeholder = canvas.captureStream(1)
        call = peer.call(targetPeerId, placeholder)
        if (!call) {
          fail("Could not start the camera call. Check browser WebRTC support.")
          return
        }
        cameraCallRef.current = call
        timeout = setTimeout(() => fail("No video arrived from the camera. Keep its tab open until it shows LIVE, then reconnect."), 25000)
        call.on("stream", (stream: MediaStream) => {
          if (settled) return
          settled = true
          clearConnectionTimeout()
          placeholder?.getTracks().forEach((track) => track.stop())
          streamRef.current = stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            void videoRef.current.play().catch(() => {
              toast.error("The camera is connected, but this browser blocked video playback. Check the browser's autoplay settings.")
            })
          }
          setConnected(true)
          setConnecting(false)
          setCameraError("")
          toast.success("Camera connected")
        })
        call.on("error", (error: PeerError<string>) => fail(cameraConnectionError(error)))
        call.on("close", () => {
          clearConnectionTimeout()
          placeholder?.getTracks().forEach((track) => track.stop())
          if (peerRef.current === peer) {
            cameraCallRef.current = null
            streamRef.current = null
            setConnected(false)
            setConnecting(false)
            if (!settled) fail("The camera closed its video connection. Reopen the camera node and reconnect.")
          }
        })
        call.on("iceStateChanged", (state: RTCIceConnectionState) => {
          if (state === "failed") {
            fail(cameraConnectionError(Object.assign(new Error("WebRTC connection failed"), { type: "webrtc" })))
          }
        })
      })
      peer.on("error", (error: PeerError<string>) => fail(cameraConnectionError(error)))
      peer.on("disconnected", () => fail("PeerJS signaling disconnected. Check your internet and try connecting again."))
    } catch (error) {
      setConnected(false)
      setConnecting(false)
      const message = error instanceof Error ? error.message : "WebRTC connection unavailable. Check this browser supports peer connections."
      setCameraError(message)
      toast.error(message)
    }
  }
  const saveZone = async () => { try { await saveSentinelSettings({ ...DEFAULT_SETTINGS, ...accountSettings, zone }); await mutate("sentinel-settings"); toast.success("Restricted zone synced to your account") } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save restricted zone") } }
  const setRect = (event: React.MouseEvent<HTMLDivElement>) => { if (!drawing) return; const bounds = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height; if (!start) setStart({x,y}); else { setZone({ x: Math.min(start.x,x), y: Math.min(start.y,y), w: Math.abs(x-start.x), h: Math.abs(y-start.y) }); setStart(null); setDrawing(false) } }
  const send = async (path: string) => { try { await helperRequest(path, { method: "POST", body: JSON.stringify({}) }); toast.success(path.includes("test") ? "Alarm test sent" : "Alarm stopped") } catch { toast.error("Helper unavailable", { description: "Check the helper URL and network connection." }) } }
  const lastPir = status?.last_pir ? fmtTime(status.last_pir) : "No motion recorded"
  const lastAi = events.find((event) => event.type?.toLowerCase() === "ai")
  const timeline = useMemo(() => {
    const now = Date.now()
    const windowMs = 4 * 60 * 60 * 1000
    return Array.from({ length: 6 }, (_, index) => {
      const start = now - (6 - index) * windowMs
      const end = start + windowMs
      const alerts = events.filter(event => event.timestamp * 1000 >= start && event.timestamp * 1000 < end).length
      return { time: index === 5 ? "Now" : `-${(6 - index) * 4}h`, alerts }
    })
  }, [events])
  return <main className="console-shell"><Toaster theme="light" position="top-right" richColors />
    <header className="topbar"><Link href="/viewer" className="brand"><BrandLogo /></Link><span className="top-divider" /><div className="device-state"><span className={`status-dot ${status?.online ? "online" : "unknown"}`} />ESP32{status?.online ? " ONLINE" : ""}</div>{status && <div className={`motion-tag ${status.last_pir && Date.now()/1000-status.last_pir<10 ? "active" : ""}`}><Zap size={14} />{status.last_pir && Date.now()/1000-status.last_pir<10 ? "MOTION" : "NO MOTION"}</div>}<div className="top-spacer"/><time className="clock">{clock?.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}) || "--:--:--"}</time><button className="icon-button" aria-label={sound ? "Mute alarm sound" : "Enable alarm sound"} onClick={() => setSound(!sound)}>{sound ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button><button className="icon-button" aria-label="Toggle fullscreen" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}><Expand size={17}/></button></header>
    <nav className="subnav"><div className="nav-links"><Link href="/viewer" className="nav-item selected"><Activity size={15}/> Monitor</Link><Link href="/snapshots" className="nav-item"><Image size={15}/> Snapshots</Link><Link href="/settings" className="nav-item"><Shield size={15}/> Settings</Link><Link href="/" className="nav-item"><Camera size={15}/> Camera node</Link></div><div className="session-pill"><span className="status-dot online"/> PRIVATE ACCOUNT · SYNCED</div></nav>
    {eventError && <div className="network-warning">Activity history is temporarily unavailable.<button onClick={() => void mutate("sentinel-events")}>Retry</button></div>}
    <section className="page-heading"><div><p className="eyebrow">CONTROL ROOM <span>·</span> NORTH ENTRY</p><h1>Live monitoring</h1><p className="page-subtitle">Real-time surveillance and intrusion detection</p></div><div className="heading-actions">{status?.online && <span className="updated"><span className="status-dot online"/> ESP32 connected</span>}<button className="button button-secondary" onClick={() => send("/test-alarm")}><Siren size={15}/> Test alarm</button></div></section>
    <section className="dashboard-grid"><div className="main-column">
      <article className="panel feed-panel"><div className="panel-heading"><div><span className="eyebrow">CAMERA FEED</span><h2>North entrance <span className="camera-index">CAM 01</span></h2></div><div className="feed-actions"><span className={`live-pill ${connected ? "" : "offline-pill"}`}><i/>{connected ? "LIVE" : "STANDBY"}</span><button className="icon-button" title="Connect camera" onClick={connectPhone}><Link2 size={16}/></button></div></div>
        <div className="feed-window" onClick={setRect} onMouseMove={(event) => { if (drawing && start) { const bounds = event.currentTarget.getBoundingClientRect(); const x=(event.clientX-bounds.left)/bounds.width,y=(event.clientY-bounds.top)/bounds.height; setZone({x:Math.min(start.x,x),y:Math.min(start.y,y),w:Math.abs(x-start.x),h:Math.abs(y-start.y)}) } }}>
          <video ref={videoRef} autoPlay muted playsInline className={`remote-feed ${connected ? "visible" : ""}`} aria-label="Remote phone camera feed"/>{!connected && <div className="feed-no-signal"><div className="signal-icon"><Video size={29}/></div><strong>{connecting ? "Connecting…" : "No camera signal"}</strong><span role="status">{cameraError || "Start the camera node on your phone, wait for LIVE, then connect."}</span><button className="button button-primary" disabled={connecting} onClick={(event) => {event.stopPropagation(); void connectPhone()}}><Wifi size={15}/>{connecting ? "Connecting…" : "Connect camera"}</button></div>}
          <div className="feed-overlay-top"><span className="mono">CAM-01 · LIVE VIDEO</span><span className="mono">{clock?.toLocaleTimeString() || "--:--:--"}</span></div><div className="feed-target" style={{left:`${zone.x*100}%`,top:`${zone.y*100}%`,width:`${zone.w*100}%`,height:`${zone.h*100}%`}}/><div className="feed-overlay-bottom"><span><span className="rec-dot"/> REC</span><span>{connected ? "STREAM ENCRYPTED" : "AWAITING CONNECTION"}</span></div>
          {drawing && <span className="draw-hint">Click two corners to draw a restricted zone</span>}
        </div><div className="feed-toolbar"><div className="toolbar-left"><span className="zone-state"><span/> Restricted zone active</span><span className="toolbar-separator"/><span className="mono muted">SOURCE {accountSettings?.camera_peer_id?.slice(0, 16) || "NOT PAIRED"}</span></div><div className="toolbar-actions"><button className="button button-quiet" onClick={() => setDrawing(!drawing)}>{drawing ? "Cancel drawing" : "Set zone"}</button><button className="button button-quiet" onClick={() => setZone(DEFAULT_ZONE)}>Clear</button><button className="button button-secondary compact" onClick={saveZone}>Save zone</button></div></div></article>
      <article className="panel log-panel"><div className="panel-heading log-head"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Alert log</h2></div><Link href="/snapshots" className="text-link">View all <ChevronDown size={14}/></Link></div>{events.length ? <div className="alert-table"><div className="alert-row table-header"><span>EVENT</span><span>TIME</span><span>CONFIDENCE</span><span>STATUS</span></div>{events.slice(0,5).map((event) => <div className="alert-row" key={event.id}><span className="event-name"><span className="event-icon"><ShieldAlert size={14}/></span>{event.type || "AI detection"}</span><span className="mono muted">{fmtTime(event.timestamp)}</span><span className="mono">{event.confidence ? `${Math.round(event.confidence*100)}%` : "—"}</span><span className="event-resolved">RECORDED</span></div>)}</div> : <div className="empty-row"><Activity size={17}/><span>No alerts recorded. Monitoring is active.</span></div>}</article>
    </div><aside className="side-column">
      <article className="panel status-panel"><div className="panel-heading"><div><span className="eyebrow">HARDWARE STATUS</span><h2>Device health</h2></div>{(status?.online || helperReachable) && <span className={`device-pill ${status?.online ? "good" : "pending"}`}><i/>{status?.online ? "Online" : "Waiting"}</span>}</div><div className="health-row"><span className="health-icon cyan"><Wifi size={16}/></span><span><strong>ESP32 Sentinel</strong><small>{status?.online ? "Connected and ready" : helperReachable ? "Waiting for device response" : "Waiting for connection"}</small></span><span className="health-value">{status?.online ? "READY" : "—"}</span></div><div className="health-row"><span className="health-icon amber"><Zap size={16}/></span><span><strong>Last PIR trigger</strong><small>{lastPir}</small></span></div><div className="health-row"><span className="health-icon purple"><ShieldAlert size={16}/></span><span><strong>Last AI detection</strong><small>{lastAi ? fmtTime(lastAi.timestamp) : "No person detected"}</small></span></div><button className="button button-danger full-width" onClick={() => send("/stop-alarm")}><Circle size={13}/> Stop alarm</button></article>
      <article className="panel timeline-panel"><div className="panel-heading"><div><span className="eyebrow">ACTIVITY</span><h2>Alert timeline</h2></div><span className="period">24 HOURS <ChevronDown size={12}/></span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline}><defs><linearGradient id="alertFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d71935" stopOpacity={0.24}/><stop offset="100%" stopColor="#d71935" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fill:"#71717a",fontSize:10}}/><Tooltip contentStyle={{background:"#ffffff",border:"1px solid #e4e4e7",borderRadius:10,color:"#18181b",fontSize:12,boxShadow:"0 8px 24px rgba(24,24,27,.12)"}}/><Area type="monotone" dataKey="alerts" stroke="#d71935" strokeWidth={2.5} fill="url(#alertFill)"/></AreaChart></ResponsiveContainer></div><div className="chart-footer"><span><i/> Intrusion events</span><strong>{events.length} <small>recent</small></strong></div></article>
      <article className="panel cooldown-panel"><div className="cooldown-icon"><Clock3 size={17}/></div><div><span className="eyebrow">ALERT COOLDOWN</span><strong>{cooldown ? `${Math.floor(cooldown/60)}:${String(cooldown%60).padStart(2,"0")}` : "Ready"}</strong><small>{cooldown ? "Until next notification" : "Alerts can be sent now"}</small></div></article>
      <article className="panel snapshots-panel"><div className="panel-heading"><div><span className="eyebrow">CAPTURED EVENTS</span><h2>Recent snapshots</h2></div><Link href="/snapshots" className="icon-button" aria-label="View all snapshots"><Image size={16}/></Link></div><div className="mini-gallery">{events.slice(0,3).map((event) => <button key={event.id} className="mini-shot" onClick={() => setSnapshotOpen(event)}>{event.imageUrl ? <img src={event.imageUrl} alt="Person detection snapshot"/> : <div><Camera size={17}/></div>}<span>{fmtTime(event.timestamp)}</span></button>)}{events.length===0 && <div className="mini-empty"><Camera size={19}/><span>Snapshots appear here when activity is detected</span></div>}</div></article>
    </aside></section><footer className="app-footer"><span>SentinelEye <span className="footer-dot">·</span> Security monitoring system</span></footer>
    {snapshotOpen && <div className="modal-backdrop" onClick={() => setSnapshotOpen(null)}><div className="snapshot-modal" onClick={(event)=>event.stopPropagation()}><button className="modal-close" onClick={()=>setSnapshotOpen(null)}>×</button>{snapshotOpen.imageUrl ? <img src={snapshotOpen.imageUrl} alt="Private person detection snapshot"/> : <div className="modal-empty"><Camera size={30}/><span>Snapshot image unavailable</span></div>}<strong>{snapshotOpen.type} · {fmtTime(snapshotOpen.timestamp)}</strong></div></div>}
  </main>
}
function playAlarm() { try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = "sawtooth"; oscillator.frequency.value = 780; gain.gain.value = 0.035; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.32); oscillator.onended = () => context.close() } catch { /* Audio may be blocked until a user gesture. */ } }
