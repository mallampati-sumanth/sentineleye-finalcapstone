"""FastAPI bridge for the SentinelEye web console, alerts, and ESP32.

Run from this directory with: python -m uvicorn main:app --host 0.0.0.0 --port 8000
The helper is intended for a trusted LAN. Do not expose it directly to the public internet.
"""
from __future__ import annotations

import ipaddress
import json
import logging
import mimetypes
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import alerts
import config
from esp32_client import ESP32Client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sentinel.helper")
config.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="SentinelEye Helper", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS or ["http://localhost:3000"], allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
board = ESP32Client(config.ESP32_BASE_URL, config.ESP32_TIMEOUT_SECONDS)
state: dict[str, Any] = {"last_pir": None, "last_ai": None, "config": {}, "started_at": time.time()}


class ConfigPayload(BaseModel):
    zone: dict[str, float] | None = None
    cooldown: int | None = Field(default=None, ge=0, le=86400)
    email: str | None = None
    telegramChatId: str | None = None
    esp32Ip: str | None = None
    channels: dict[str, bool] | None = None


class EventPayload(BaseModel):
    type: str = "pir"
    source: str = "esp32"
    timestamp: float | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    person_detected: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


def _event_files() -> list[Path]:
    return sorted(config.SNAPSHOT_DIR.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)


def _read_events() -> list[dict[str, Any]]:
    events = []
    for path in _event_files():
        try:
            events.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            logger.warning("Skipping unreadable event metadata %s", path.name)
    return events


def _save_event(event: dict[str, Any], image: bytes | None = None, media_type: str | None = None) -> dict[str, Any]:
    event_id = uuid.uuid4().hex
    if image:
        extension = ".png" if media_type == "image/png" else ".jpg"
        image_path = config.SNAPSHOT_DIR / f"{event_id}{extension}"
        image_path.write_bytes(image)
        event["imageUrl"] = f"/snapshots/{event_id}"
    event.update({"id": event_id, "timestamp": event.get("timestamp") or time.time()})
    (config.SNAPSHOT_DIR / f"{event_id}.json").write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8")
    return event


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "sentineleye-helper"}


@app.get("/status")
def status() -> dict[str, Any]:
    device = board.status() if config.ESP32_BASE_URL else {"online": False, "alarm": False, "uptime": 0}
    return {**device, "helper_online": True, "last_pir": state["last_pir"], "last_ai": state["last_ai"], "snapshot_count": len(_event_files()), "uptime": int(time.time() - state["started_at"])}


@app.get("/events")
def events() -> list[dict[str, Any]]:
    return _read_events()[:100]


@app.get("/snapshots")
def snapshots() -> list[dict[str, Any]]:
    return [{**event, "url": event.get("imageUrl")} for event in _read_events() if event.get("imageUrl")]


@app.get("/snapshots/{event_id}")
def snapshot_image(event_id: str) -> FileResponse:
    if not event_id.isalnum() or len(event_id) != 32:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    for extension in (".jpg", ".png"):
        path = config.SNAPSHOT_DIR / f"{event_id}{extension}"
        if path.is_file():
            return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")
    raise HTTPException(status_code=404, detail="Snapshot not found")


@app.post("/alert")
async def create_alert(metadata: str = Form("{}"), file: UploadFile | None = File(None)) -> dict[str, Any]:
    """Accept multipart fields `file` and JSON-string `metadata`."""
    try:
        payload = EventPayload.model_validate_json(metadata)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="metadata must be a valid event JSON object") from exc
    image_bytes = None
    media_type = None
    if file:
        media_type = file.content_type
        if media_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(status_code=415, detail="Only JPEG and PNG images are supported")
        image_bytes = await file.read(config.MAX_UPLOAD_BYTES + 1)
        if len(image_bytes) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Image exceeds upload limit")
    event = payload.model_dump()
    event["type"] = event["type"].lower()
    if event["type"] in {"ai", "intrusion"}:
        accepted, remaining = alerts.cooldown_accept(time.time(), config.ALERT_COOLDOWN_SECONDS)
        if not accepted:
            return {"status": "cooldown", "remaining": remaining}
    saved = await run_in_threadpool(_save_event, event, image_bytes, media_type)
    if saved["type"] == "pir":
        state["last_pir"] = saved["timestamp"]
    else:
        state["last_ai"] = saved["timestamp"]
        if config.ESP32_BASE_URL:
            try:
                await run_in_threadpool(board.intrusion)
            except RuntimeError as exc:
                logger.warning("Could not trigger ESP32 for AI event: %s", exc)
    logger.info("Recorded %s event %s", saved["type"], saved["id"])
    return {"status": "ok", "id": saved["id"], "saved": saved.get("imageUrl", ""), **saved}


@app.post("/pir")
def pir_event(payload: EventPayload = EventPayload(type="pir", source="esp32")) -> dict[str, Any]:
    """Called by the ESP32 on GPIO14 motion; drives a short alert cooldown."""
    now = time.time()
    state["last_pir"] = now
    saved = _save_event({**payload.model_dump(), "type": "pir", "source": "esp32", "timestamp": now})
    accepted, remaining = alerts.cooldown_accept(now, config.ALERT_COOLDOWN_SECONDS)
    if accepted:
        logger.warning("PIR motion event %s — alert cooldown started", saved["id"])
        if config.ESP32_BASE_URL:
            try:
                board.intrusion()
            except RuntimeError as exc:
                logger.warning("Could not trigger ESP32 alarm: %s", exc)
    else:
        logger.info("PIR event %s recorded; alert cooldown has %ss remaining", saved["id"], remaining)
    return {"status": "ok", "source": "pir", "event_id": saved["id"], "alert_sent": accepted, "cooldown_remaining": remaining}


@app.post("/intrusion")
def intrusion() -> dict[str, Any]:
    try:
        return board.intrusion()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/stop")
def stop_alarm() -> dict[str, Any]:
    try:
        return board.stop()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/stop-alarm")
def stop_alarm_alias() -> dict[str, Any]:
    return stop_alarm()


@app.post("/test-alarm")
def test_alarm() -> dict[str, Any]:
    try:
        return board.intrusion()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/config")
def get_config() -> dict[str, Any]:
    return {"status": "ok", "config": state["config"]}


@app.post("/config")
def save_config(payload: ConfigPayload) -> dict[str, Any]:
    global board
    updates = payload.model_dump(exclude_none=True)
    if payload.esp32Ip:
        host = payload.esp32Ip.strip()
        try:
            address = ipaddress.ip_address(host)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="ESP32 address must be a private LAN IP address") from exc
        if not address.is_private:
            raise HTTPException(status_code=422, detail="ESP32 address must be a private LAN IP address")
        config.ESP32_BASE_URL = f"http://{address.compressed}"
        board = ESP32Client(config.ESP32_BASE_URL, config.ESP32_TIMEOUT_SECONDS)
    if payload.cooldown is not None:
        config.ALERT_COOLDOWN_SECONDS = payload.cooldown
    state["config"].update(updates)
    return {"status": "ok", "config": state["config"]}
