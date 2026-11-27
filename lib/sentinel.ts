export const PHONE_ID = "sentinel-phone-v1"
export const DEFAULT_ZONE = { x: 0.65, y: 0.18, w: 0.25, h: 0.56 }
export const HELPER_URL = process.env.NEXT_PUBLIC_HELPER_URL?.replace(/\/$/, "") || ""

const iceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
]

if (process.env.NEXT_PUBLIC_TURN_URL) {
  iceServers.push({
    urls: process.env.NEXT_PUBLIC_TURN_URL,
    username: process.env.NEXT_PUBLIC_TURN_USERNAME || undefined,
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || undefined,
  })
}

export const PEER_CONFIG = {
  debug: 1,
  config: { iceServers },
}
export const readConfig = () => { try { return JSON.parse(localStorage.getItem("sentinel-config") || "{}") } catch { return {} } }
export const saveConfig = (config: Record<string, unknown>) => { localStorage.setItem("sentinel-config", JSON.stringify(config)) }
export async function helperRequest(path: string, init?: RequestInit) {
  if (!HELPER_URL) throw new Error("Set NEXT_PUBLIC_HELPER_URL to connect the helper API")
  const response = await fetch(`${HELPER_URL}${path}`, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } })
  if (!response.ok) throw new Error(`Helper request failed (${response.status})`)
  return response.json()
}
export const fmtTime = (value?: number | string) => value ? new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "No activity yet"
