# SentinelEye

SentinelEye is a local-network smart-surveillance prototype: a phone browser can stream video to the monitoring console, while an ESP32 reports PIR activity to a small FastAPI helper and controls an alarm, LED, and buzzer.

## Project attribution

SentinelEye is the capstone project of Mallampati Sumanth, who completed the project. The project/repository URL and the Git commits are associated with Mannam Ganesh Babu; the repository URL and commit history do not identify Sumanth as the committer.

## Project layout

- `app/` — responsive web console, camera node, settings, and event gallery
- `helper/` — FastAPI service, alert cooldown, ESP32 HTTP client, and `.env.example`
- `esp32/sentinel_eye.ino` — Arduino firmware

## Start the web console

Copy `.env.local.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to your Supabase project's URL and public publishable key. The app also supports the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` as a fallback. These values are available in the Vercel project's Environment Variables or Supabase project API settings; never use a service-role or secret key in the browser app. For local hardware testing, set `NEXT_PUBLIC_HELPER_URL` to the helper's address (for example `http://127.0.0.1:8000` on the same computer or `http://192.168.1.10:8000` on a LAN). Restart the Next.js dev server after changing `.env.local`, then open `/viewer`. Run the monitor and phone camera node from the same origin or HTTPS; browsers require a secure context for camera access.

To test notifications locally, add your email provider's `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`, plus `TELEGRAM_BOT_TOKEN`, to the server-only `.env.local` file. For Gmail, use `smtp.gmail.com` on port `465` and a Google app password, not your account password. Never prefix these secrets with `NEXT_PUBLIC_` or commit `.env.local`. In SentinelEye Settings, enter the email recipient and Telegram chat ID, enable the channels, and save. The Telegram chat ID is saved with the signed-in user's settings; it is not an environment variable. To find it, start a chat with your bot and inspect `message.chat.id` returned by Telegram `getUpdates`. Use **Test email** and **Test Telegram** to check delivery; the Telegram test sends formatted text. Restart the dev server after changing environment variables. Real camera person-detection events submit a snapshot to the web API and send email/Telegram alerts when those channels are enabled and configured.

Open `/` on a phone to use it as a camera node. Sign in to the same account used on the monitoring device, grant camera permission, and leave the phone on the camera page while it shows **LIVE**. Open `/viewer` on another phone, tablet, or computer and select **Connect camera**. The receiving video is muted for reliable mobile autoplay. PeerJS uses its public signaling service by default; media connectivity can still depend on NAT/firewall rules, so same-Wi-Fi connections are the most reliable unless your deployment provides a TURN relay. No video is uploaded to the helper by the camera node.

### Test the camera locally

1. Configure `.env.local` with the Supabase project URL and public anon/publishable key, and allow `http://localhost:3000/auth/callback` in Supabase's redirect URLs. Restart `pnpm dev`.
2. Open the deployed HTTPS site (or an HTTPS development tunnel) on the camera phone and sign in. Grant camera access and wait for `/` to show **LIVE**.
3. On a second device, open the same HTTPS site, sign in to the same account, and open `/viewer`. Select **Connect camera**. Keep the camera phone's page open; connection failures show guidance for pairing, signaling, or network errors.

`localhost` is a secure context for camera permission on the development computer. A phone cannot use the computer's plain `http://192.168...` development URL for camera access; test from a phone through HTTPS (for example the deployed HTTPS site) or an HTTPS development tunnel. Both devices need internet access for PeerJS signaling; same Wi-Fi is recommended for the media connection.

## Configure deployed sign-in

In the Vercel project, set `NEXT_PUBLIC_SUPABASE_URL` to the Supabase project URL and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to that project's publishable key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains supported for legacy projects. These are public client settings; never use a service-role or secret key for either variable. Keep using the Supabase project with the SentinelEye tables, storage bucket, and `record_sentinel_detection` function already provisioned; this repository does not include a database migration.

In Supabase Authentication URL configuration, set the production site URL to the deployed app's origin and add `https://<your-deployment-domain>/auth/callback` to the allowed redirect URLs. Also add any Vercel preview origins that need email confirmation. Email/password sign-in requires an existing account; if email confirmation is enabled, confirm the account before signing in. For unexpected auth failures, check Supabase Authentication logs.

For production email and Telegram alerts, add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `TELEGRAM_BOT_TOKEN` as server-only Vercel environment variables, then redeploy. Rotate any credentials that have been shared or exposed. Do not set `NEXT_PUBLIC_HELPER_URL` to `localhost` or `127.0.0.1` in Vercel: those addresses point to the visitor's device. The current FastAPI helper has no authentication or TLS, so do not expose it publicly; leave the helper URL unset in Vercel until a secured, reachable hardware gateway is available.

## Run the Python helper

1. Copy `helper/.env.example` to `helper/.env` and set `ESP32_BASE_URL` to the ESP32's address. Add the web console's exact origin to `CORS_ORIGINS` if it is not `http://localhost:3000`.
2. Install `helper/requirements.txt` in a Python 3.10+ environment.
3. From `helper/`, run `python -m uvicorn main:app --host 0.0.0.0 --port 8000`.
4. Verify `GET /health`, then `GET /status`.

The helper stores event metadata and images in `helper/data/snapshots` by default. The local `/alert` route accepts multipart fields `metadata` (a JSON string) and optional `file` (JPEG or PNG). The ESP32 sends JSON to `POST /pir`. The helper exposes `GET /status`, `GET /events`, `GET /snapshots`, `POST /intrusion`, `POST /stop`, `POST /test-alarm`, and `POST /config`.

The FastAPI helper is intended for a trusted local network. It has no authentication or TLS, and stores its own event files under `helper/data`; do not expose it directly to the public internet. The Next.js web app stores account settings and camera-detection snapshots in Supabase. It can send email and Telegram alerts when the server-side providers are configured. The standalone helper's ESP32/PIR events are stored locally and do not currently trigger those web-app notifications. SMS is not implemented.

## Flash the ESP32

Open `esp32/sentinel_eye.ino` in Arduino IDE, install the ESP32 Arduino core, replace the Wi-Fi and helper URL constants, select the matching ESP32 board/port, and upload. Read the device IP from Serial Monitor at 115200 baud and configure that same address in `ESP32_BASE_URL`. The HTTP server offers `GET /status` and `GET|POST /intrusion` and `/stop` on port 80. The alarm times out after 10 seconds; LED blinking is non-blocking.

## Wiring diagram

```text
                         ESP32 DevKit
                    ┌──────────────────┐
  PIR sensor        │                  │
  ┌─────────┐       │                  │
  │ VCC ────┼───────┤ 5V / VIN         │
  │ OUT ────┼───────┤ GPIO 14          │
  │ GND ────┼───┬───┤ GND              │
  └─────────┘   │   │                  │
                │   │ GPIO 26 ─────────┼──── (+) Active buzzer (-) ──┐
                │   │                  │                             │
                │   │ GPIO 27 ──[220Ω]─┼─────|>| Red LED ────────────┤
                │   │                  │                             │
                └───┴──────────────────┤ GND                         │
                    └──────────────────┘                             │
                                                                     └─ GND
```

Use a 220–330 Ω LED resistor. Connect the LED anode (long leg) toward GPIO 27 through the resistor; connect its cathode (short leg/flat side) to GND. The buzzer shown is a low-current active buzzer/module whose input accepts the ESP32's 3.3 V GPIO signal. Do not connect a buzzer drawing more than the GPIO rating directly: use an NPN transistor or logic-level MOSFET driver, a base/gate resistor, and a suitable external supply; add a flyback diode for an inductive buzzer. Share grounds. Check your PIR module's voltage and output specifications; share ground. Do not apply 5 V to ESP32 GPIO pins.

## Five-minute professor walkthrough

**0:00–0:40 — Introduce the system.** Show the SentinelEye monitor. Explain the three connected pieces: a browser camera node, the ESP32/PIR hardware, and a local Python helper. Point out that the monitor displays live status, motion state, recent alerts, snapshots, and cooldown.

**0:40–1:30 — Show the camera path.** Open `/` on a phone, allow camera access, and leave the page open. Return to `/viewer` on the monitor and select **Connect camera**. Show the live feed and explain that video is relayed peer-to-peer using WebRTC/PeerJS and is not uploaded. A detection snapshot is submitted separately to the authenticated web API and saved to the user's private Supabase storage.

**1:30–2:25 — Demonstrate motion detection.** Wave a hand in front of the PIR. Explain the signal path: PIR OUT raises GPIO 14, the ESP32 sends `POST /pir` over Wi-Fi, and the helper records the timestamped event and enforces its cooldown. Show the last-trigger status on the dashboard and the helper's local `/events` endpoint for the PIR record. The dashboard alert log contains web-app detection events; the standalone helper's PIR records are stored separately. The firmware's 3-second report gap prevents a continuously-high PIR output from flooding the helper.

**2:25–3:15 — Test the alarm controls.** Use **Test alarm** on the monitor (or `POST /intrusion`). Show the buzzer sounding and red LED blinking; then select **Stop alarm** (or `POST /stop`). Trigger the alarm again and let the 10-second hardware timeout demonstrate automatic shutoff. Explain that the LED uses a `millis()` blink timer rather than a blocking delay.

**3:15–4:05 — Explore settings and snapshots.** Open Settings to review the cooldown, detection zone, alert destinations, and hardware address. Use **Test email** or **Test Telegram** to demonstrate provider delivery. Show the snapshot gallery and explain that camera-detection snapshots are stored in the user's private Supabase storage; the standalone helper keeps its own local PIR/event files. Email and Telegram delivery require server-side provider configuration. SMS is not implemented.

**4:05–5:00 — Summarize and discuss limitations.** Trace the hardware path (PIR → ESP32 → helper → alarm/status) and the camera path (camera → detection snapshot → Supabase → configured alerts). Show `/status` or `/health` if useful. The FastAPI helper is designed for a trusted LAN and has no authentication or TLS; do not expose it directly to the public internet. A production hardware integration needs a secured, reachable helper. The web deployment also needs configured Supabase auth URLs and server-side notification credentials.
