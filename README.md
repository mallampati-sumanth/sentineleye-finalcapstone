# SentinelEye

SentinelEye is a local-network smart-surveillance prototype: a phone browser can stream video to the monitoring console, while an ESP32 reports PIR activity to a small FastAPI helper and controls an alarm, LED, and buzzer.

## Project layout

- `app/` — responsive web console, camera node, settings, and event gallery
- `helper/` — FastAPI service, alert cooldown, ESP32 HTTP client, and `.env.example`
- `esp32/sentinel_eye.ino` — Arduino firmware

## Start the web console

Copy `.env.local.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to your Supabase project's URL and public publishable/anon key. These values are available in the Vercel project's Environment Variables or Supabase project API settings; never use a service-role or secret key in the browser app. Set `NEXT_PUBLIC_HELPER_URL` to your helper's URL (for example `http://127.0.0.1:8765` for local development or `http://192.168.1.10:8000` on a LAN). Restart the Next.js dev server after changing `.env.local`, then open `/viewer`. Run the monitor and phone camera node from the same origin or HTTPS; browsers require a secure context for camera access.

To test notifications locally, add your email provider's `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`, plus `TELEGRAM_BOT_TOKEN`, to the server-only `.env.local` file. Never prefix these secrets with `NEXT_PUBLIC_` or commit `.env.local`. In SentinelEye Settings, enter the recipient email and Telegram chat ID, enable the channels, and save. Use **Test email** and **Test Telegram** to send a test message through each provider. For Gmail, use an app password rather than your account password. Telegram recipients must start a chat with the bot before it can message them. Restart the dev server after changing environment variables. A real person-detection event sends the normal alert; email provider configuration and Telegram text delivery are exercised by the test buttons.

Open `/` on a phone to use it as a camera node. Grant camera permission and leave the tab open. On the monitor, select **Connect camera**. PeerJS uses its public signaling service by default; local-network peer connectivity can still depend on NAT/firewall rules. No video is uploaded to the helper by the camera node.

## Configure deployed sign-in

In the Vercel project, set `NEXT_PUBLIC_SUPABASE_URL` to the Supabase project URL and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to that project's publishable/anon key. These are public client settings; never use a service-role or secret key for either variable. Redeploy after changing them.

In Supabase Authentication URL configuration, set the production site URL to the deployed app's origin and add `https://<your-deployment-domain>/auth/callback` to the allowed redirect URLs. Also add any Vercel preview origins that need email confirmation. Email/password sign-in requires an existing account; if email confirmation is enabled, confirm the account before signing in. For unexpected auth failures, check Supabase Authentication logs.

## Run the Python helper

1. Copy `helper/.env.example` to `helper/.env` and set `ESP32_BASE_URL` to the ESP32's address. Add the web console's exact origin to `CORS_ORIGINS` if it is not `http://localhost:3000`.
2. Install `helper/requirements.txt` in a Python 3.10+ environment.
3. From `helper/`, run `python -m uvicorn main:app --host 0.0.0.0 --port 8000`.
4. Verify `GET /health`, then `GET /status`.

The helper stores event metadata and images in `helper/data/snapshots` by default. The local `/alert` route accepts multipart fields `metadata` (a JSON string) and optional `file` (JPEG or PNG). The ESP32 sends JSON to `POST /pir`. The helper exposes `GET /status`, `GET /events`, `GET /snapshots`, `POST /intrusion`, `POST /stop`, `POST /test-alarm`, and `POST /config`.

This prototype is intended for a trusted local network. It does not include authentication, TLS termination, email/Telegram/SMS provider credentials, or persistent settings storage. Do not expose the helper to the public internet without adding authentication, authorization, HTTPS, and request rate limiting. Email and Telegram settings are preferences only; the demo does not deliver external notifications.

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

**0:40–1:30 — Show the camera path.** Open `/` on a phone, allow camera access, and leave the page open. Return to `/viewer` on the monitor and select **Connect camera**. Show the live feed and explain that video is relayed peer-to-peer using WebRTC/PeerJS; the helper stores only event images explicitly submitted to `/alert`.

**1:30–2:25 — Demonstrate motion detection.** Wave a hand in front of the PIR. Explain the signal path: PIR OUT raises GPIO 14, the ESP32 sends `POST /pir` over Wi-Fi, and the helper records the timestamped event and enforces the cooldown. Show the last-trigger value and activity log on the dashboard. The firmware's 3-second report gap prevents a continuously-high PIR output from flooding the helper.

**2:25–3:15 — Test the alarm controls.** Use **Test alarm** on the monitor (or `POST /intrusion`). Show the buzzer sounding and red LED blinking; then select **Stop alarm** (or `POST /stop`). Trigger the alarm again and let the 10-second hardware timeout demonstrate automatic shutoff. Explain that the LED uses a `millis()` blink timer rather than a blocking delay.

**3:15–4:05 — Explore settings and snapshots.** Open Settings to review the cooldown, detection zone, alert-channel preferences, and hardware address. Show the snapshot gallery and explain that the helper persists JSON metadata and JPEG/PNG captures in its local data directory. Mention that external email/SMS/Telegram delivery requires a provider integration and is intentionally not configured in this classroom prototype.

**4:05–5:00 — Summarize and discuss limitations.** Trace one end-to-end event: PIR → ESP32 → helper → monitor, and show `/status` or `/health` if useful. Call out that the prototype is designed for a trusted LAN and has no authentication or TLS; a production deployment would add authenticated APIs, secure transport, durable database-backed event retention, and configured notification providers.
